// Home mode on a tailnet (Settings → Addresses → Tailscale). With an OAuth client
// from the person's Tailscale admin console, Hamstr joins their tailnet as a
// machine of its own (the tailscaled that ships in the appliance, userspace
// networking), serves the shell at https://<machine>.<tailnet>.ts.net and gives
// every live crumb a Tailscale Service, https://crumb-<id>.<tailnet>.ts.net,
// with Tailscale's certificates. lib/tailnet-services.ts does the per-crumb work;
// this module owns the machine, the stored client and the sync loop.
//
// Without a tailscaled socket (HAMSTR_TAILSCALE_SOCKET) the option is shown as
// unavailable. The client secret lives in hamstr.db and is never sent back to
// the browser or written to a log or a command line (`--auth-key=file:`).
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";
import { createTailnetServices } from "../../../lib/tailnet-services.ts";

const execFileAsync = promisify(execFile);
const API = "https://api.tailscale.com/api/v2";
const TAG = /^tag:[a-z0-9][a-z0-9-]{0,62}$/;
const DOMAIN = /^[a-z0-9-]+(\.[a-z0-9-]+)*\.ts\.net$/;
const SYNC_EVERY_MS = 60_000;
const DEFAULT_TAGS = ["tag:server", "tag:container"];
const DEFAULT_SERVICE_TAG = "tag:container";

type Run = (file: string, args: string[], opts?: { timeout?: number }) => Promise<{ stdout: string }>;
interface Saved {
	clientId: string;
	clientSecret: string;
	tags: string[];
	serviceTag: string;
	/** Marks the service definitions this Hamstr made: only those are ever deleted. */
	instance: string;
}
export interface TailnetOptions {
	db: any;
	/** tailscaled's socket; empty: this install has no Tailscale. */
	socket: string;
	cli?: string;
	/** Where Tailscale sends the shell's and the crumbs' traffic: Hamstr's own listener. */
	upstream: string;
	/** The machine name to ask for; Tailscale adds -1, -2 when it is taken. */
	hostname: string;
	tmpDir: string;
	/** The live crumbs, each to get a service. */
	crumbs: () => { id: string }[];
	error: (status: number, message: string) => Error;
	run?: Run;
	fetch?: typeof fetch;
	log?: (message: string) => void;
	syncEveryMs?: number;
}
export interface TailnetStatus {
	available: boolean;
	configured: boolean;
	/** off · connecting · running · error */
	state: string;
	/** The shell's own https name, e.g. hamstr.siren-macaroni.ts.net. */
	shell: string;
	domain: string;
	clientId: string;
	tags: string[];
	serviceTag: string;
	services: number;
	lastSync: { at: number; added: number; removed: number; failed: number } | null;
	error: string;
}

const lastLine = (err: any) =>
	String(err?.stderr || err?.message || err)
		.trim()
		.split("\n")
		.filter(Boolean)
		.pop()
		?.slice(0, 300) ?? "failed";

export function createTailnet(options: TailnetOptions) {
	const { db, socket, cli = "tailscale", upstream, hostname, tmpDir, crumbs, error } = options;
	const run: Run = options.run ?? ((file, args, opts) => execFileAsync(file, args, { timeout: opts?.timeout ?? 30_000, maxBuffer: 8 * 1024 * 1024 }));
	const http = options.fetch ?? fetch;
	const log = options.log ?? ((m) => console.error(`hamstr: tailnet: ${m}`));
	const ts = (args: string[], timeout?: number) => run(cli, [`--socket=${socket}`, ...args], { timeout });
	const json = (text: string) => {
		const at = text.indexOf("{");
		return at < 0 ? {} : JSON.parse(text.slice(at));
	};

	const load = (): Saved | null => {
		try {
			const row = db.prepare("SELECT value FROM settings WHERE key = 'tailnet'").get();
			const v = row ? JSON.parse(String(row.value)) : null;
			return v?.clientId && v?.clientSecret ? v : null;
		} catch {
			return null;
		}
	};
	const store = (v: Saved | null) => {
		if (!v) db.prepare("DELETE FROM settings WHERE key = 'tailnet'").run();
		else db.prepare("INSERT INTO settings (key, value) VALUES ('tailnet', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(JSON.stringify(v));
	};

	let saved = load();
	let node = { state: "", shell: "", domain: "" };
	let services = 0;
	let lastSync: TailnetStatus["lastSync"] = null;
	let lastError = "";
	let reconciler: ReturnType<typeof createTailnetServices> | null = null;
	let reconcilerFor = "";
	const available = () => !!socket && existsSync(socket);

	/** The tailscaled state, and the shell's name and tailnet domain from it. */
	async function readNode() {
		const s = json((await ts(["status", "--json"])).stdout);
		const domain = String(s.MagicDNSSuffix ?? "").toLowerCase();
		const shell = String(s.Self?.DNSName ?? "").toLowerCase().replace(/\.$/, "");
		node = { state: String(s.BackendState ?? ""), domain: DOMAIN.test(domain) ? domain : "", shell: domain && shell.endsWith(`.${domain}`) ? shell : "" };
		return node;
	}

	/** A token for the client, and a check that it can do what Hamstr needs. */
	async function checkClient(clientId: string, clientSecret: string) {
		let res: Response;
		try {
			res = await http(`${API}/oauth/token`, {
				method: "POST",
				headers: { authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
				body: "grant_type=client_credentials",
				signal: AbortSignal.timeout(10_000),
			});
		} catch (err) {
			throw error(502, `Could not reach Tailscale (${(err as Error).message}). Is this box online?`);
		}
		if (res.status === 401 || res.status === 400) throw error(400, "Tailscale did not accept this client ID and secret.");
		if (!res.ok) throw error(502, `Tailscale answered HTTP ${res.status}; try again in a moment.`);
		const scopes = String(((await res.json()) as any).scope ?? "").split(/\s+/);
		const missing = ["auth_keys", "services"].filter((s) => !scopes.includes(s) && !scopes.includes("all"));
		if (missing.length) throw error(400, `The OAuth client needs write access to ${missing.map((s) => (s === "auth_keys" ? "Auth Keys" : "Services")).join(" and ")}.`);
	}

	/** Logs the machine in with the client secret, used as an auth key (tagged, not ephemeral). */
	async function login(v: Saved) {
		const keyFile = join(tmpDir, `tailnet-${randomBytes(8).toString("hex")}`);
		writeFileSync(keyFile, `${v.clientSecret}?ephemeral=false&preauthorized=true`, { mode: 0o600 });
		try {
			await ts(["up", `--auth-key=file:${keyFile}`, `--advertise-tags=${v.tags.join(",")}`, `--hostname=${hostname}`, "--reset"], 90_000);
		} catch (err) {
			throw error(400, `Tailscale refused the login: ${lastLine(err)}`);
		} finally {
			rmSync(keyFile, { force: true });
		}
	}

	/** The shell on https://<machine>.<tailnet>.ts.net, unless it already is. */
	async function serveShell() {
		const status = json((await ts(["serve", "status", "--json"])).stdout);
		const handler = status.Web?.[`${node.shell}:443`]?.Handlers?.["/"]?.Proxy;
		if (String(handler ?? "").replace(/\/$/, "") === upstream.replace(/\/$/, "")) return;
		await ts(["serve", "--bg", "--https=443", upstream]);
	}

	function servicesFor(v: Saved, maxRemovals = 20) {
		const key = `${v.clientId}|${v.serviceTag}|${v.instance}|${maxRemovals}`;
		if (!reconciler || reconcilerFor !== key) {
			reconciler = createTailnetServices({
				clientId: v.clientId,
				clientSecret: v.clientSecret,
				tag: v.serviceTag,
				upstream,
				instance: v.instance,
				maxRemovals,
				run: (file, args) => run(file, [`--socket=${socket}`, ...args]),
				fetch: http,
				log,
			});
			reconcilerFor = key;
		}
		return reconciler;
	}

	/** One cycle: machine logged in, shell served, one service per live crumb. */
	async function cycle() {
		const v = saved;
		if (!v || !available()) return;
		try {
			if (["NeedsLogin", "NoState"].includes((await readNode()).state)) {
				await login(v);
				await readNode();
			}
			if (node.state !== "Running" || !node.shell) {
				lastError = `Tailscale is ${node.state || "not ready"}.`;
				return;
			}
			await serveShell();
			const wanted = crumbs();
			const r = await servicesFor(v).reconcile(wanted.map((c) => ({ id: c.id, comment: "Hamstr app" })));
			services = wanted.length - r.failed;
			lastSync = { at: Date.now(), added: r.added, removed: r.removed, failed: r.failed };
			lastError = r.failed ? `${r.failed} app${r.failed === 1 ? "" : "s"} could not be set up; Hamstr retries every minute.` : "";
		} catch (err) {
			lastError = (err as any)?.status ? (err as Error).message : lastLine(err);
			log(`sync failed: ${lastError}`);
		}
	}

	// One cycle at a time; a request during one runs another right after it.
	let running: Promise<void> | null = null;
	let again = false;
	function sync(): Promise<void> {
		if (running) {
			again = true;
			return running;
		}
		running = (async () => {
			do {
				again = false;
				await cycle();
			} while (again);
		})().finally(() => (running = null));
		return running;
	}
	let pokeTimer: ReturnType<typeof setTimeout> | null = null;
	/** A crumb was made, trashed, restored or deleted: sync soon. */
	function poke() {
		if (!saved || pokeTimer) return;
		pokeTimer = setTimeout(() => {
			pokeTimer = null;
			sync().catch(() => {});
		}, 500);
		pokeTimer.unref?.();
	}
	const timer = setInterval(() => saved && sync().catch(() => {}), options.syncEveryMs ?? SYNC_EVERY_MS);
	timer.unref?.();
	if (saved && available()) setTimeout(() => sync().catch(() => {}), 1000).unref?.();

	const offStatus = (available: boolean): TailnetStatus => ({
		available,
		configured: false,
		state: "off",
		shell: "",
		domain: "",
		clientId: "",
		tags: DEFAULT_TAGS,
		serviceTag: DEFAULT_SERVICE_TAG,
		services: 0,
		lastSync: null,
		error: "",
	});
	const stateOf = (ok: boolean) => (!ok || lastError ? "error" : node.state === "Running" && node.shell ? "running" : "connecting");

	async function status(): Promise<TailnetStatus> {
		const ok = available();
		const v = saved;
		if (!v) return offStatus(ok);
		if (ok) await readNode().catch(() => {});
		return {
			available: ok,
			configured: true,
			state: stateOf(ok),
			shell: node.shell,
			domain: node.domain,
			clientId: v.clientId,
			tags: v.tags,
			serviceTag: v.serviceTag,
			services,
			lastSync,
			error: ok ? lastError : "This install's Tailscale is not running.",
		};
	}

	const parseTags = (value: unknown, fallback: string[]) => {
		const list = (Array.isArray(value) ? value : String(value ?? "").split(/[\s,]+/)).map((t) => String(t).trim().toLowerCase()).filter(Boolean);
		if (!list.length) return fallback;
		for (const t of list) if (!TAG.test(t)) throw error(400, `"${t.slice(0, 40)}" is not a tag; tags look like tag:server.`);
		return [...new Set(list)];
	};

	/** The connect form, checked; an empty secret keeps the saved one (to change tags without pasting it again). */
	function readInput(input: any) {
		const clientId = String(input?.clientId ?? "").trim();
		const clientSecret = String(input?.clientSecret ?? "").trim() || (saved?.clientId === clientId ? saved.clientSecret : "");
		if (!/^[A-Za-z0-9]{6,64}$/.test(clientId)) throw error(400, "Paste the OAuth client's ID.");
		if (!/^tskey-client-[A-Za-z0-9-]{6,200}$/.test(clientSecret)) throw error(400, "Paste the OAuth client's secret; it starts with tskey-client-.");
		const tags = parseTags(input?.tags, DEFAULT_TAGS);
		const [serviceTag] = parseTags(input?.serviceTag, [DEFAULT_SERVICE_TAG]);
		return { clientId, clientSecret, tags, serviceTag };
	}

	/** A machine that is already in with these tags stays as it is (a reconnect, or
	 * a new secret for the same client); anything else logs in afresh. */
	async function enter(next: Saved) {
		const before = await readNode().catch(() => node);
		const sameTags = saved?.tags.join(",") === next.tags.join(",");
		if (before.state === "Running" && sameTags) return;
		if (before.state === "Running") await ts(["logout"]).catch(() => {});
		await login(next);
	}

	/** Settings → Addresses → Tailscale → Connect. Checks the client, logs in, serves. */
	async function connect(input: any) {
		if (!available()) throw error(409, "This install has no Tailscale built in.");
		const fields = readInput(input);
		await checkClient(fields.clientId, fields.clientSecret);
		const next: Saved = { ...fields, instance: saved?.instance ?? randomBytes(6).toString("hex") };
		await enter(next);
		await readNode();
		if (node.state !== "Running" || !node.shell) throw error(502, `Tailscale is ${node.state || "not ready"}; try again in a moment.`);
		saved = next;
		store(saved);
		lastError = "";
		await sync();
		return status();
	}

	/** Turn off: remove this Hamstr's services, stop serving and take the machine off the tailnet. */
	async function disconnect() {
		const v = saved;
		if (!v) return status();
		if (available()) {
			try {
				const r = await servicesFor(v, Number.MAX_SAFE_INTEGER).reconcile([]);
				if (r.failed) log(`turning off: ${r.failed} services could not be removed`);
				await ts(["serve", "reset"]).catch((err) => log(`serve reset: ${lastLine(err)}`));
				// A tagged machine that logs out is removed from the tailnet.
				await ts(["logout"]).catch((err) => log(`logout: ${lastLine(err)}`));
			} catch (err) {
				log(`turning off: ${lastLine(err)}`);
			}
		}
		saved = null;
		store(null);
		reconciler = null;
		services = 0;
		lastSync = null;
		lastError = "";
		node = { state: "", shell: "", domain: "" };
		return status();
	}

	return {
		status,
		connect,
		disconnect,
		sync,
		poke,
		/** The tailnet's domain and the shell's name there, once the machine is in. */
		get domain() {
			return saved && node.state === "Running" ? node.domain : "";
		},
		get shell() {
			return saved && node.state === "Running" ? node.shell : "";
		},
		close() {
			clearInterval(timer);
			if (pokeTimer) clearTimeout(pokeTimer);
		},
	};
}
