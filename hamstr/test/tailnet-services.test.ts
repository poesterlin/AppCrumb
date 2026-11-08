// Tailscale Services reconciler, against a fake control plane and a fake `tailscale` CLI.
// Run: node --test test/tailnet-services.test.ts
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createTailnetServices, serviceName } from "../lib/tailnet-services.ts";

const ID = (n: number) => String(n).padStart(12, "a").replace(/[^a-z0-9]/g, "b");
const UP = "http://127.0.0.1:8000";

/** A fake tailnet: definitions, served and advertised sets, and a call log. */
function world(opts: { defs?: string[]; served?: string[]; servedProxy?: string; advertised?: string[]; fail?: (call: string) => number | undefined; failRun?: (call: string) => boolean; failMessage?: string; tokenTtl?: number; instance?: string; upstream?: string; maxRemovals?: number; foreign?: string[] } = {}) {
	const defs = new Map<string, any>((opts.defs ?? []).map((n) => [n, { name: n, tags: ["tag:container"], ports: ["tcp:443"], addrs: ["100.1.1.1"], comment: opts.instance ? `hamstr:${opts.instance}` : "Hamstr crumb" }]));
	// Definitions that other machines (or other Hamstrs) own: here only on the control plane.
	for (const n of opts.foreign ?? []) defs.set(n, { name: n, tags: ["tag:container"], ports: ["tcp:443"], addrs: ["100.9.9.9"], comment: "hamstr:other" });
	// What this machine serves, with the proxy target the CLI would report for each.
	const served = new Map<string, string>((opts.served ?? []).map((n) => [n, opts.servedProxy ?? UP]));
	const advertised = new Set(opts.advertised ?? []);
	const calls: string[] = [];
	let tokens = 0;
	let clock = 1_000_000;
	const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
	const fakeFetch = async (url: any, init: any = {}) => {
		const u = new URL(String(url));
		const call = `${init.method ?? "GET"} ${u.pathname.replace("/api/v2", "")}`;
		calls.push(call);
		const forced = opts.fail?.(call);
		if (forced) return reply(forced);
		if (u.pathname.endsWith("/oauth/token")) {
			tokens++;
			assert.match(init.headers.authorization, /^Basic /);
			assert.equal(init.body, "grant_type=client_credentials");
			return reply(200, { access_token: `tok${tokens}`, expires_in: opts.tokenTtl ?? 3600 });
		}
		assert.equal(init.headers.authorization, `Bearer tok${tokens}`, "uses the current token");
		const name = decodeURIComponent(u.pathname.split("/services/")[1] ?? "");
		if (init.method === "PUT") {
			const body = JSON.parse(init.body);
			defs.set(body.name, body);
			return reply(200, body);
		}
		if (init.method === "DELETE") return defs.delete(name) ? reply(200) : reply(404);
		return reply(200, { vipServices: [...defs.values()] });
	};
	const fakeRun = async (_file: string, args: string[]) => {
		calls.push(`tailscale ${args.join(" ")}`);
		if (opts.failRun?.(args.join(" "))) throw new Error(opts.failMessage ?? "denied");
		if (args[0] === "serve" && args[1] === "status") {
			return { stdout: `Warning: something\n${JSON.stringify({ Services: Object.fromEntries([...served.keys()].map((n) => [n, { Web: { [`${n}:443`]: { Handlers: { "/": { Proxy: served.get(n) } } } } }])) })}` };
		}
		if (args[0] === "debug") return { stdout: JSON.stringify({ AdvertiseServices: [...advertised] }) };
		const flag = args.find((a) => a.startsWith("--service="));
		if (flag) served.set(flag.slice(10), args[args.length - 1]);
		if (args[1] === "advertise") advertised.add(args[2]);
		if (args[1] === "drain") advertised.delete(args[2]);
		if (args[1] === "clear") {
			served.delete(args[2]);
			advertised.delete(args[2]); // clearing withdraws the advertisement
		}
		return { stdout: "" };
	};
	const logs: string[] = [];
	const svc = createTailnetServices({ clientId: "id", clientSecret: "s3cret", upstream: opts.upstream ?? UP, instance: opts.instance, maxRemovals: opts.maxRemovals, run: fakeRun, fetch: fakeFetch as any, log: (m) => logs.push(m), now: () => clock });
	return { svc, defs, served, advertised, calls, logs, tick: (ms: number) => (clock += ms), tokens: () => tokens };
}

describe("tailnet services", () => {
	it("validates names strictly", () => {
		assert.equal(serviceName("abc123abc123"), "crumb-abc123abc123");
		assert.equal(serviceName("ABC123abc123"), "crumb-abc123abc123", "lowercased");
		for (const bad of ["", "a b", "a/b", "a_b", "x".repeat(60), "../etc", "a.b", "a\nb"]) assert.equal(serviceName(bad), null, JSON.stringify(bad));
	});

	it("defines, serves and advertises a new crumb, in that order", async () => {
		const w = world();
		const r = await w.svc.reconcile([{ id: ID(1), comment: "Kitchen" }]);
		assert.deepEqual({ added: r.added, removed: r.removed, unchanged: r.unchanged, failed: r.failed }, { added: 1, removed: 0, unchanged: 0, failed: 0 });
		const name = `svc:crumb-${ID(1)}`;
		const writes = w.calls.filter((c) => c.includes(name));
		assert.deepEqual(writes, [`PUT /tailnet/-/services/${name}`, `tailscale serve --service=${name} --https=443 ${UP}`, `tailscale serve advertise ${name}`]);
		assert.deepEqual(w.defs.get(name), { name, tags: ["tag:container"], ports: ["tcp:443"], comment: "Kitchen" });
		assert.ok(w.served.has(name) && w.advertised.has(name));
		assert.ok(w.calls.includes(`tailscale serve --service=${name} --https=443 ${UP}`));
		assert.ok(w.calls.indexOf(`tailscale serve advertise ${name}`) > w.calls.indexOf(`tailscale serve --service=${name} --https=443 ${UP}`));
	});

	it("does nothing on a second run", async () => {
		const w = world();
		await w.svc.reconcile([{ id: ID(1), comment: "Kitchen" }]);
		w.calls.length = 0;
		const r = await w.svc.reconcile([{ id: ID(1), comment: "Kitchen" }]);
		assert.deepEqual({ added: r.added, removed: r.removed, unchanged: r.unchanged, failed: r.failed }, { added: 0, removed: 0, unchanged: 1, failed: 0 });
		assert.equal(w.calls.filter((c) => /^(PUT|DELETE)|--service|advertise|drain|clear/.test(c)).length, 0, "no writes");
	});

	it("updates a definition whose tags or comment differ, keeping its addrs and ports", async () => {
		const name = `svc:crumb-${ID(1)}`;
		const w = world({ defs: [name], served: [name], advertised: [name] });
		w.defs.get(name)!.tags = ["tag:other"];
		const r = await w.svc.reconcile([{ id: ID(1), comment: "Kitchen" }]);
		assert.equal(r.failed, 0);
		const put = w.defs.get(name)!;
		assert.deepEqual(put.tags, ["tag:container"]);
		assert.deepEqual(put.addrs, ["100.1.1.1"]);
		assert.equal(put.comment, "Kitchen");
	});

	it("removes in order: drain, clear, then delete the definition", async () => {
		const gone = `svc:crumb-${ID(2)}`;
		const w = world({ defs: [gone], served: [gone], advertised: [gone], instance: "me" });
		const r = await w.svc.reconcile([]);
		assert.equal(r.removed, 1);
		const seq = w.calls.filter((c) => c.includes(gone));
		assert.deepEqual(seq, [`tailscale serve drain ${gone}`, `tailscale serve clear ${gone}`, `DELETE /tailnet/-/services/${gone}`]);
		assert.equal(w.defs.size, 0);
	});

	it("never touches services that are not crumbs", async () => {
		const w = world({ defs: ["svc:app01", "svc:crumbly", "svc:jellyfin"], served: ["svc:app01"], advertised: ["svc:app01"] });
		const r = await w.svc.reconcile([]);
		assert.equal(r.removed, 0);
		assert.equal(w.defs.size, 3);
		assert.equal(w.calls.filter((c) => /DELETE|drain|clear/.test(c)).length, 0);
	});

	it("keeps the definition when drain fails", async () => {
		const gone = `svc:crumb-${ID(2)}`;
		const w = world({ defs: [gone], served: [gone], advertised: [gone], failRun: (c) => c.startsWith("serve drain") });
		const r = await w.svc.reconcile([]);
		assert.deepEqual({ removed: r.removed, failed: r.failed }, { removed: 0, failed: 1 });
		assert.equal(w.defs.size, 1, "the definition stays");
		assert.ok(!w.calls.some((c) => c.startsWith("DELETE")));
	});

	it("skips invalid ids and counts them as failed", async () => {
		const w = world();
		const r = await w.svc.reconcile([{ id: "../x" }, { id: ID(3) }]);
		assert.equal(r.failed, 1);
		assert.equal(r.added, 1);
		assert.ok(![...w.defs.keys()].some((n) => n.includes("..")));
	});

	it("reuses the token until shortly before it expires", async () => {
		const w = world({ tokenTtl: 3600 });
		await w.svc.reconcile([{ id: ID(1) }]);
		await w.svc.reconcile([{ id: ID(1) }]);
		assert.equal(w.tokens(), 1);
		w.tick(3500 * 1000);
		await w.svc.reconcile([{ id: ID(1) }]);
		assert.equal(w.tokens(), 1, "still fresh a little before the end");
		w.tick(50 * 1000); // 3550 s in: inside the one-minute margin
		await w.svc.reconcile([{ id: ID(1) }]);
		assert.equal(w.tokens(), 2, "refreshed before it expires");
	});

	it("survives a 429 or 500 on one definition and retries it next cycle", async () => {
		let hits = 0;
		const bad = `svc:crumb-${ID(1)}`;
		const w = world({ fail: (c) => (c === `PUT /tailnet/-/services/${bad}` && hits++ === 0 ? 429 : undefined) });
		const first = await w.svc.reconcile([{ id: ID(1) }, { id: ID(2) }]);
		assert.equal(first.failed, 1);
		assert.equal(first.added, 1, "the other crumb still went through");
		assert.ok(!w.served.has(bad), "not served without a definition");
		const second = await w.svc.reconcile([{ id: ID(1) }, { id: ID(2) }]);
		assert.deepEqual({ failed: second.failed, added: second.added, unchanged: second.unchanged }, { failed: 0, added: 1, unchanged: 1 });
		const basic = Buffer.from("id:s3cret").toString("base64");
		assert.ok(w.logs.length > 0, "something was logged");
		assert.ok(w.logs.every((l) => !l.includes("s3cret") && !l.includes(basic) && !l.includes("tok1")));
	});

	it("does nothing when the list call fails, and never deletes", async () => {
		const gone = `svc:crumb-${ID(2)}`;
		const w = world({ defs: [gone], fail: (c) => (c.startsWith("GET /tailnet") ? 500 : undefined) });
		const r = await w.svc.reconcile([{ id: ID(1) }]);
		assert.equal(r.failed, 1);
		assert.equal(w.defs.size, 1);
		assert.equal(w.calls.filter((c) => /^(PUT|DELETE)|--service/.test(c)).length, 0);
	});

	it("handles 200 crumbs with one list call", async () => {
		const w = world();
		const desired = Array.from({ length: 200 }, (_, i) => ({ id: ID(i + 1) }));
		const r = await w.svc.reconcile(desired);
		assert.equal(r.added, 200);
		assert.equal(w.calls.filter((c) => c === "GET /tailnet/-/services").length, 1);
		w.calls.length = 0;
		assert.equal((await w.svc.reconcile(desired)).unchanged, 200);
		assert.equal(w.calls.filter((c) => c === "GET /tailnet/-/services").length, 1, "still one per cycle");
	});

	it("never deletes a definition that another Hamstr or machine owns", async () => {
		const mine = `svc:crumb-${ID(1)}`;
		const theirs = `svc:crumb-${ID(9)}`;
		for (const instance of ["me", undefined]) {
			const w = world({ instance, defs: [mine], served: [mine], advertised: [mine], foreign: [theirs] });
			const r = await w.svc.reconcile([{ id: ID(1) }]);
			assert.equal(r.removed, 0);
			assert.ok(w.defs.has(theirs), `foreign definition kept (instance ${instance})`);
			assert.equal(w.calls.filter((c) => /DELETE|drain|clear/.test(c)).length, 0);
		}
	});

	it("without an instance mark it withdraws what it serves but deletes no definition", async () => {
		const gone = `svc:crumb-${ID(2)}`;
		const w = world({ defs: [gone], served: [gone], advertised: [gone] });
		const r = await w.svc.reconcile([]);
		assert.equal(r.removed, 1);
		assert.ok(!w.served.has(gone) && !w.advertised.has(gone));
		assert.ok(w.defs.has(gone));
		assert.ok(!w.calls.some((c) => c.startsWith("DELETE")));
	});

	it("marks its definitions, and an empty crumb list cannot wipe the tailnet", async () => {
		const names = Array.from({ length: 25 }, (_, i) => `svc:crumb-${ID(i + 1)}`);
		const w = world({ instance: "me", defs: names, served: names, advertised: names });
		const r = await w.svc.reconcile([]);
		assert.deepEqual({ removed: r.removed, failed: r.failed }, { removed: 0, failed: 25 });
		assert.equal(w.defs.size, 25);
		assert.ok(w.logs.some((l) => /refusing to remove 25/.test(l)));
		const big = world({ instance: "me", maxRemovals: 30, defs: names, served: names, advertised: names });
		assert.equal((await big.svc.reconcile([])).removed, 25);
		const put = world({ instance: "me" });
		await put.svc.reconcile([{ id: ID(1), comment: "Kitchen" }]);
		assert.equal(put.defs.get(`svc:crumb-${ID(1)}`)!.comment, "hamstr:me Kitchen");
	});

	it("is idempotent when the CLI reports the proxy a little differently", async () => {
		const name = `svc:crumb-${ID(1)}`;
		// We configure ...:8000/ and the CLI reports ...:8000 (no slash).
		const w = world({ upstream: "http://localhost:8000/", servedProxy: "http://localhost:8000", defs: [name], served: [name], advertised: [name] });
		w.defs.get(name)!.comment = "Kitchen";
		const r = await w.svc.reconcile([{ id: ID(1), comment: "Kitchen" }]);
		assert.deepEqual({ added: r.added, unchanged: r.unchanged }, { added: 0, unchanged: 1 });
		assert.equal(w.calls.filter((c) => /--service|advertise|drain|clear/.test(c)).length, 0, "no re-serving, no outage");
	});

	it("serves again and re-advertises when the upstream really changed", async () => {
		const name = `svc:crumb-${ID(1)}`;
		const w = world({ servedProxy: "http://127.0.0.1:9999", defs: [name], served: [name], advertised: [name] });
		w.defs.get(name)!.comment = undefined as any;
		await w.svc.reconcile([{ id: ID(1) }]);
		assert.equal(w.served.get(name), UP);
		assert.ok(w.advertised.has(name), "clearing withdrew it, so it is advertised again");
		assert.ok(w.calls.indexOf(`tailscale serve clear ${name}`) < w.calls.indexOf(`tailscale serve advertise ${name}`));
	});

	it("treats nothing-to-clear as success, so a removal does not stick", async () => {
		const gone = `svc:crumb-${ID(2)}`;
		const w = world({ instance: "me", defs: [gone], served: [gone], advertised: [], failRun: (c) => c.startsWith("serve drain") || c.startsWith("serve clear"), failMessage: "service not configured" });
		const r = await w.svc.reconcile([]);
		assert.deepEqual({ removed: r.removed, failed: r.failed }, { removed: 1, failed: 0 });
		assert.ok(!w.defs.has(gone));
	});

	it("gets a new token after a 401", async () => {
		let first = true;
		const w = world({ fail: (c) => (c.startsWith("GET /tailnet") && first && !(first = false) ? 401 : undefined) });
		const r = await w.svc.reconcile([{ id: ID(1) }]);
		assert.equal(r.failed, 0);
		assert.equal(w.tokens(), 2);
	});

	it("ignores names from the tailnet that are not exactly svc:crumb-<12>", async () => {
		const w = world({ defs: ["svc:crumb-short", "svc:crumb-aaaaaaaaaaaa-extra", "svc:crumb--evil"], served: ["svc:crumb-short"], advertised: ["svc:crumb-short"] });
		await w.svc.reconcile([]);
		assert.equal(w.calls.filter((c) => /DELETE|drain|clear/.test(c)).length, 0);
	});

	it("dry run reads only", async () => {
		const gone = `svc:crumb-${ID(2)}`;
		const w = world({ defs: [gone], served: [gone], advertised: [gone], instance: "me" });
		const r = await w.svc.reconcile([{ id: ID(1) }], { dryRun: true });
		assert.ok(r.plan.some((p) => p.startsWith("PUT ")) && r.plan.some((p) => p.startsWith("DELETE ")));
		assert.equal(w.calls.filter((c) => /^(PUT|DELETE)|--service|advertise|drain|clear/.test(c)).length, 0);
		assert.equal(w.defs.size, 1);
	});
});
