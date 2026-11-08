// Tailscale Services for crumbs: one `svc:crumb-<id>` per crumb, so a crumb is
// reachable at https://crumb-<id>.<tailnet>.ts.net with a certificate from Tailscale.
// Modelled on what DockTail does (control-plane API for the definitions, the
// `tailscale` CLI for serving and advertising), with the input being a list of
// crumb ids instead of Docker labels. Prototype: nothing here is wired into the
// running server; see tools/tailnet-sync.ts and docs/tailnet-services.md.
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const API = "https://api.tailscale.com/api/v2";
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** The only names this module ever touches: svc:crumb-<12 chars>, as Hamstr's crumb ids are. */
const OWNED = /^svc:crumb-[a-z0-9]{12}$/;
/** A proxy target compared as a URL, so a trailing slash or default port does not look like a change. */
const normalise = (target: string) => {
	try {
		const u = new URL(target);
		return `${u.protocol}//${u.host}${u.pathname === "/" ? "" : u.pathname}`;
	} catch {
		return target;
	}
};
/** What the CLI says when there is nothing to drain or clear: not a failure. */
const NOTHING_THERE = /not (found|configured|serving|advertis)|no such|does not exist|nothing to/i;

export interface Desired {
	id: string;
	comment?: string;
}
export interface Summary {
	added: number;
	removed: number;
	unchanged: number;
	failed: number;
	/** What was (or, with dryRun, would be) done, in order. */
	plan: string[];
}
type Run = (file: string, args: string[]) => Promise<{ stdout: string }>;
interface Options {
	clientId: string;
	clientSecret: string;
	tailnet?: string;
	tag?: string;
	upstream?: string;
	/** An id for this Hamstr. Definitions are marked `hamstr:<instance>` in their comment, and only
	 *  definitions with that mark are ever deleted from the tailnet. Without it, none are. */
	instance?: string;
	/** Most services removed in one cycle (default 20): a wrong or empty crumb list cannot wipe everything. */
	maxRemovals?: number;
	run?: Run;
	fetch?: typeof fetch;
	log?: (message: string) => void;
	now?: () => number;
}

/** The service name for a crumb id, or null if it is not a valid DNS label. */
export function serviceName(id: string): string | null {
	const name = `crumb-${String(id).toLowerCase()}`;
	return NAME.test(name) ? name : null;
}

export function createTailnetServices(options: Options) {
	const { clientId, clientSecret, tailnet = "-", tag = "tag:container", upstream = "http://127.0.0.1:8000", instance = "", maxRemovals = 20 } = options;
	const mark = instance ? `hamstr:${instance}` : "";
	const isMine = (def: any) => !!mark && (def?.comment === mark || String(def?.comment ?? "").startsWith(`${mark} `));
	const run: Run = options.run ?? ((file, args) => execFileAsync(file, args, { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 }));
	const http = options.fetch ?? fetch;
	const log = options.log ?? ((m) => console.error(`tailnet-services: ${m}`));
	const now = options.now ?? Date.now;
	if (!clientId || !clientSecret) throw new Error("clientId and clientSecret are required");

	let token = "";
	let tokenUntil = 0;
	async function bearer() {
		if (token && now() < tokenUntil) return token;
		const res = await http(`${API}/oauth/token`, {
			method: "POST",
			headers: {
				authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
				"content-type": "application/x-www-form-urlencoded"
			},
			body: "grant_type=client_credentials",
			signal: AbortSignal.timeout(10_000)
		});
		if (!res.ok) throw new Error(`token request failed: HTTP ${res.status}`);
		const body: any = await res.json();
		if (!body.access_token) throw new Error("token response has no access_token");
		token = String(body.access_token);
		// Refresh early: a minute, or half the lifetime when that is shorter.
		const life = Number(body.expires_in ?? 3600);
		tokenUntil = now() + (life - Math.min(60, life / 2)) * 1000;
		return token;
	}
	async function api(method: string, path: string, body?: unknown, retry = true): Promise<Response> {
		const res = await http(`${API}/tailnet/${encodeURIComponent(tailnet)}${path}`, {
			method,
			headers: { authorization: `Bearer ${await bearer()}`, ...(body !== undefined && { "content-type": "application/json" }) },
			body: body === undefined ? undefined : JSON.stringify(body),
			signal: AbortSignal.timeout(10_000)
		});
		if (res.status === 401 && retry) {
			// A revoked or expired token: get a fresh one once.
			await res.body?.cancel();
			token = "";
			return api(method, path, body, false);
		}
		return res;
	}
	const sameSet = (a: string[], b: string[]) => a.length === b.length && new Set(a).size === new Set(b).size && a.every((x) => b.includes(x));

	/** The CLI prints warnings before the JSON sometimes. */
	const json = (text: string) => {
		const at = text.indexOf("{");
		return at < 0 ? {} : JSON.parse(text.slice(at));
	};

	async function reconcile(desired: Desired[], { dryRun = false }: { dryRun?: boolean } = {}): Promise<Summary> {
		const summary: Summary = { added: 0, removed: 0, unchanged: 0, failed: 0, plan: [] };
		const step = (text: string) => summary.plan.push(text);
		const failedNames = new Set<string>();
		const fail = (name: string, what: string, err: unknown) => {
			failedNames.add(name);
			log(`${what} ${name}: ${(err as Error).message}`);
		};

		// Desired names, validated; one name per crumb.
		const want = new Map<string, Desired>();
		for (const d of desired) {
			const name = serviceName(d.id);
			if (!name) {
				summary.failed++;
				log(`skipping crumb id with no valid service name: ${JSON.stringify(String(d.id).slice(0, 40))}`);
				continue;
			}
			want.set(`svc:${name}`, d);
		}

		// One read of everything per cycle: definitions, what is served, what is advertised.
		let defs = new Map<string, any>();
		let served = new Set<string>();
		let advertised = new Set<string>();
		let proxies = new Map<string, string>();
		try {
			const res = await api("GET", "/services");
			if (!res.ok) throw new Error(`listing services failed: HTTP ${res.status}`);
			const listed: any = await res.json();
			for (const s of listed.vipServices ?? []) if (OWNED.test(String(s.name))) defs.set(String(s.name), s);
			const status = json((await run("tailscale", ["serve", "status", "--json"])).stdout);
			for (const [name, svc] of Object.entries<any>(status.Services ?? {})) {
				if (!OWNED.test(name)) continue;
				served.add(name);
				for (const web of Object.values<any>(svc?.Web ?? {})) for (const h of Object.values<any>(web?.Handlers ?? {})) if (h?.Proxy) proxies.set(name, normalise(String(h.Proxy)));
			}
			const prefs = json((await run("tailscale", ["debug", "prefs"])).stdout);
			advertised = new Set<string>((prefs.AdvertiseServices ?? []).filter((n: string) => OWNED.test(String(n))));
		} catch (err) {
			// Without a trustworthy picture, change nothing (and above all delete nothing).
			log(`cannot read the current state, doing nothing this cycle: ${(err as Error).message}`);
			summary.failed += want.size;
			return summary;
		}

		const exec = async (name: string, args: string[], what: string) => {
			step(`tailscale ${args.join(" ")}`);
			if (dryRun) return true;
			try {
				await run("tailscale", args);
				return true;
			} catch (err) {
				const text = `${(err as Error).message} ${(err as any).stderr ?? ""}`;
				if ((what === "drain" || what === "clear") && NOTHING_THERE.test(text)) return true;
				fail(name, what, err);
				return false;
			}
		};

		// 1. Remove. "Ours" means this host serves or advertises it (evidence from this machine);
		// the tailnet-wide definition is deleted only when its comment carries our instance mark,
		// so another Hamstr's (or anyone's) svc:crumb-* definitions are never touched.
		const gone = [...new Set([...served, ...advertised])].filter((n) => !want.has(n));
		const stale = [...defs].filter(([n, d]) => !want.has(n) && isMine(d) && !gone.includes(n)).map(([n]) => n);
		if (gone.length + stale.length > maxRemovals) {
			log(`refusing to remove ${gone.length + stale.length} services in one cycle (limit ${maxRemovals}); is the crumb list complete?`);
			summary.failed += gone.length + stale.length;
		} else {
			for (const name of [...gone, ...stale]) {
				let clean = true;
				if (served.has(name) || advertised.has(name)) {
					clean = (await exec(name, ["serve", "drain", name], "drain")) && (await exec(name, ["serve", "clear", name], "clear"));
				}
				if (clean && isMine(defs.get(name))) {
					step(`DELETE ${name}`);
					if (!dryRun) {
						try {
							const res = await api("DELETE", `/services/${name}`);
							await res.body?.cancel();
							if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
						} catch (err) {
							fail(name, "delete", err);
							clean = false;
						}
					}
				}
				if (clean) summary.removed++;
			}
		}

		// 2. Define, 3. serve, 4. advertise, per crumb. A definition must exist
		// before the host advertises it, or the host sticks at "0 hosts" (DockTail #72).
		for (const [name, d] of want) {
			let changed = false;
			const have = defs.get(name);
			const comment = mark ? `${mark}${d.comment ? ` ${d.comment}` : ""}` : d.comment;
			if (!have || !sameSet(have.tags ?? [], [tag]) || (comment !== undefined && (have.comment ?? "") !== comment)) {
				step(`PUT ${name}`);
				if (!dryRun) {
					try {
						// An existing definition keeps its addrs and ports: it is tailnet-wide.
						const body = have
							? { name, tags: [tag], ports: have.ports ?? ["tcp:443"], addrs: have.addrs, ...(comment !== undefined ? { comment } : have.comment ? { comment: have.comment } : {}) }
							: { name, tags: [tag], ports: ["tcp:443"], ...(comment !== undefined && { comment }) };
						const res = await api("PUT", `/services/${name}`, body);
						await res.body?.cancel();
						if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
						changed = true;
					} catch (err) {
						fail(name, "define", err);
						if (!have) continue;
					}
				} else changed = true;
			}

			let isServed = served.has(name) && proxies.get(name) === normalise(upstream);
			if (!isServed) {
				changed = true;
				const args = ["serve", `--service=${name}`, "--https=443", upstream];
				if (served.has(name)) {
					await exec(name, ["serve", "clear", name], "clear");
					advertised.delete(name); // clearing withdraws it: advertise again below
				}
				isServed = await exec(name, args, "serve");
				if (!isServed && !dryRun) {
					// "already serving" / "want to serve": clear and try once more.
					advertised.delete(name);
					if (await exec(name, ["serve", "clear", name], "clear")) isServed = await exec(name, args, "serve");
				}
			}
			if (isServed && !advertised.has(name)) {
				changed = true;
				await exec(name, ["serve", "advertise", name], "advertise");
			}
			if (failedNames.has(name)) continue;
			if (changed) summary.added++;
			else summary.unchanged++;
		}
		summary.failed += failedNames.size;
		return summary;
	}

	return { reconcile };
}
