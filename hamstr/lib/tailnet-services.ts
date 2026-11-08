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

	interface State {
		defs: Map<string, any>;
		served: Set<string>;
		advertised: Set<string>;
		proxies: Map<string, string>;
	}
	/** What one reconcile cycle does and records: the plan, the failures and the CLI runner. */
	interface Cycle {
		dryRun: boolean;
		summary: Summary;
		failedNames: Set<string>;
		step: (text: string) => void;
		fail: (name: string, what: string, err: unknown) => void;
		exec: (name: string, args: string[], what: string) => Promise<boolean>;
	}

	function newCycle(dryRun: boolean): Cycle {
		const summary: Summary = { added: 0, removed: 0, unchanged: 0, failed: 0, plan: [] };
		const failedNames = new Set<string>();
		const step = (text: string) => summary.plan.push(text);
		const fail = (name: string, what: string, err: unknown) => {
			failedNames.add(name);
			log(`${what} ${name}: ${(err as Error).message}`);
		};
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
		return { dryRun, summary, failedNames, step, fail, exec };
	}

	/** Desired names, validated; one name per crumb. */
	function wanted(desired: Desired[], cycle: Cycle) {
		const want = new Map<string, Desired>();
		for (const d of desired) {
			const name = serviceName(d.id);
			if (!name) {
				cycle.summary.failed++;
				log(`skipping crumb id with no valid service name: ${JSON.stringify(String(d.id).slice(0, 40))}`);
				continue;
			}
			want.set(`svc:${name}`, d);
		}
		return want;
	}

	/** The proxy targets and names `tailscale serve status --json` reports for our services. */
	function readServed(status: any) {
		const served = new Set<string>();
		const proxies = new Map<string, string>();
		for (const [name, svc] of Object.entries<any>(status.Services ?? {})) {
			if (!OWNED.test(name)) continue;
			served.add(name);
			const handlers = Object.values<any>(svc?.Web ?? {}).flatMap((web) => Object.values<any>(web?.Handlers ?? {}));
			for (const h of handlers) if (h?.Proxy) proxies.set(name, normalise(String(h.Proxy)));
		}
		return { served, proxies };
	}

	async function readDefinitions() {
		const res = await api("GET", "/services");
		if (!res.ok) throw new Error(`listing services failed: HTTP ${res.status}`);
		const listed: any = await res.json();
		const defs = new Map<string, any>();
		for (const s of listed.vipServices ?? []) if (OWNED.test(String(s.name))) defs.set(String(s.name), s);
		return defs;
	}

	/** One read of everything per cycle: definitions, what is served, what is advertised. */
	async function readState(): Promise<State> {
		const defs = await readDefinitions();
		const { served, proxies } = readServed(json((await run("tailscale", ["serve", "status", "--json"])).stdout));
		const prefs = json((await run("tailscale", ["debug", "prefs"])).stdout);
		const advertised = new Set<string>((prefs.AdvertiseServices ?? []).filter((n: string) => OWNED.test(String(n))));
		return { defs, served, advertised, proxies };
	}

	async function deleteDefinition(name: string, cycle: Cycle) {
		cycle.step(`DELETE ${name}`);
		if (cycle.dryRun) return true;
		try {
			const res = await api("DELETE", `/services/${name}`);
			await res.body?.cancel();
			if (!res.ok && res.status !== 404) throw new Error(`HTTP ${res.status}`);
			return true;
		} catch (err) {
			cycle.fail(name, "delete", err);
			return false;
		}
	}

	async function removeOne(name: string, state: State, cycle: Cycle) {
		let clean = true;
		if (state.served.has(name) || state.advertised.has(name)) {
			clean = (await cycle.exec(name, ["serve", "drain", name], "drain")) && (await cycle.exec(name, ["serve", "clear", name], "clear"));
		}
		if (clean && isMine(state.defs.get(name))) clean = await deleteDefinition(name, cycle);
		if (clean) cycle.summary.removed++;
	}

	/** Remove what is no longer wanted. "Ours" means this host serves or advertises it (evidence
	 *  from this machine); the tailnet-wide definition is deleted only when its comment carries our
	 *  instance mark, so another Hamstr's (or anyone's) svc:crumb-* definitions are never touched. */
	async function removeStale(want: Map<string, Desired>, state: State, cycle: Cycle) {
		const gone = [...new Set([...state.served, ...state.advertised])].filter((n) => !want.has(n));
		const stale = [...state.defs].filter(([n, d]) => !want.has(n) && isMine(d) && !gone.includes(n)).map(([n]) => n);
		const count = gone.length + stale.length;
		if (count > maxRemovals) {
			log(`refusing to remove ${count} services in one cycle (limit ${maxRemovals}); is the crumb list complete?`);
			cycle.summary.failed += count;
			return;
		}
		for (const name of [...gone, ...stale]) await removeOne(name, state, cycle);
	}

	/** The PUT body. An existing definition keeps its addrs and ports: it is tailnet-wide. */
	function definitionBody(name: string, have: any, comment: string | undefined) {
		const keep = comment !== undefined ? { comment } : have?.comment ? { comment: have.comment } : {};
		if (!have) return { name, tags: [tag], ports: ["tcp:443"], ...keep };
		return { name, tags: [tag], ports: have.ports ?? ["tcp:443"], addrs: have.addrs, ...keep };
	}

	/** Create or update the tailnet-wide definition. Returns whether it changed, and whether to go on. */
	async function define(name: string, d: Desired, have: any, cycle: Cycle): Promise<{ changed: boolean; carryOn: boolean }> {
		const comment = mark ? `${mark}${d.comment ? ` ${d.comment}` : ""}` : d.comment;
		if (have && sameSet(have.tags ?? [], [tag]) && (comment === undefined || (have.comment ?? "") === comment)) return { changed: false, carryOn: true };
		cycle.step(`PUT ${name}`);
		if (cycle.dryRun) return { changed: true, carryOn: true };
		try {
			const res = await api("PUT", `/services/${name}`, definitionBody(name, have, comment));
			await res.body?.cancel();
			if (res.status !== 200) throw new Error(`HTTP ${res.status}`);
			return { changed: true, carryOn: true };
		} catch (err) {
			cycle.fail(name, "define", err);
			return { changed: false, carryOn: !!have };
		}
	}

	/** Make this host serve the crumb through the upstream. Returns whether it changed and whether it now serves. */
	async function serve(name: string, state: State, cycle: Cycle) {
		if (state.served.has(name) && state.proxies.get(name) === normalise(upstream)) return { changed: false, served: true };
		const args = ["serve", `--service=${name}`, "--https=443", upstream];
		if (state.served.has(name)) {
			await cycle.exec(name, ["serve", "clear", name], "clear");
			state.advertised.delete(name); // clearing withdraws it: advertise again below
		}
		let served = await cycle.exec(name, args, "serve");
		if (!served && !cycle.dryRun) {
			// "already serving" / "want to serve": clear and try once more.
			state.advertised.delete(name);
			if (await cycle.exec(name, ["serve", "clear", name], "clear")) served = await cycle.exec(name, args, "serve");
		}
		return { changed: true, served };
	}

	/** Define, serve, advertise, in that order: a definition must exist before the host
	 *  advertises it, or the host sticks at "0 hosts" (DockTail #72). */
	async function ensureOne(name: string, d: Desired, state: State, cycle: Cycle) {
		const defined = await define(name, d, state.defs.get(name), cycle);
		if (!defined.carryOn) return;
		const served = await serve(name, state, cycle);
		let changed = defined.changed || served.changed;
		if (served.served && !state.advertised.has(name)) {
			changed = true;
			await cycle.exec(name, ["serve", "advertise", name], "advertise");
		}
		if (cycle.failedNames.has(name)) return;
		if (changed) cycle.summary.added++;
		else cycle.summary.unchanged++;
	}

	async function reconcile(desired: Desired[], { dryRun = false }: { dryRun?: boolean } = {}): Promise<Summary> {
		const cycle = newCycle(dryRun);
		const want = wanted(desired, cycle);
		let state: State;
		try {
			state = await readState();
		} catch (err) {
			// Without a trustworthy picture, change nothing (and above all delete nothing).
			log(`cannot read the current state, doing nothing this cycle: ${(err as Error).message}`);
			cycle.summary.failed += want.size;
			return cycle.summary;
		}
		await removeStale(want, state, cycle);
		for (const [name, d] of want) await ensureOne(name, d, state, cycle);
		cycle.summary.failed += cycle.failedNames.size;
		return cycle.summary;
	}

	return { reconcile };
}
