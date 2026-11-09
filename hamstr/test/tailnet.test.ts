// Settings → Addresses → Tailscale: Hamstr's own machine on a tailnet, against a
// fake tailscaled (CLI) and a fake control plane.
// Run: node --test test/tailnet.test.ts
import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { createTailnet } from "../src/lib/server/tailnet.ts";

const dir = mkdtempSync(join(tmpdir(), "hamstr-tailnet-"));
after(() => rmSync(dir, { recursive: true, force: true }));
const SECRET = "tskey-client-kAbCdEf-0123456789abcdef";
const UP = "http://127.0.0.1:47130";

class Failed extends Error {
	status: number;
	constructor(status: number, message: string) {
		super(message);
		this.status = status;
	}
}

function world(opts: { scope?: string; refuseTags?: boolean } = {}) {
	const db = new DatabaseSync(":memory:");
	db.exec("CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)");
	const socket = join(dir, `sock-${Math.random()}`);
	writeFileSync(socket, "");
	const tmp = mkdtempSync(join(dir, "tmp-"));
	const crumbs = [{ id: "aaaaaaaaaaa1" }, { id: "aaaaaaaaaaa2" }];
	const state = { backend: "NeedsLogin", tags: [] as string[], web: {} as Record<string, string>, services: new Map<string, string>(), advertised: new Set<string>(), keys: [] as string[] };
	const defs = new Map<string, any>();
	const calls: string[] = [];
	const run = async (file: string, args: string[]) => {
		assert.equal(file, "tailscale");
		assert.equal(args[0], `--socket=${socket}`, "every call names the socket");
		const a = args.slice(1);
		calls.push(a.join(" "));
		assert.ok(!a.join(" ").includes(SECRET), "the secret is never on a command line");
		if (a[0] === "status") return { stdout: JSON.stringify({ BackendState: state.backend, MagicDNSSuffix: "siren-macaroni.ts.net", Self: { DNSName: state.backend === "Running" ? "hamstr-1.siren-macaroni.ts.net." : "" } }) };
		if (a[0] === "up") {
			const keyFile = a.find((x) => x.startsWith("--auth-key=file:"))!.slice(16);
			state.keys.push(readFileSync(keyFile, "utf8"));
			if (opts.refuseTags) throw Object.assign(new Error("Command failed"), { stderr: 'backend error: requested tags [tag:server] are invalid or not permitted\n' });
			state.backend = "Running";
			state.tags = a.find((x) => x.startsWith("--advertise-tags="))!.slice(17).split(",");
			return { stdout: "" };
		}
		if (a[0] === "logout") {
			state.backend = "NeedsLogin";
			return { stdout: "" };
		}
		if (a[0] === "debug") return { stdout: JSON.stringify({ AdvertiseServices: [...state.advertised] }) };
		if (a[0] === "serve" && a[1] === "status") {
			return {
				stdout: JSON.stringify({
					Web: Object.fromEntries(Object.entries(state.web).map(([h, p]) => [h, { Handlers: { "/": { Proxy: p } } }])),
					Services: Object.fromEntries([...state.services].map(([n, p]) => [n, { Web: { [`${n}:443`]: { Handlers: { "/": { Proxy: p } } } } }])),
				}),
			};
		}
		if (a[0] === "serve" && a[1] === "--bg") {
			state.web["hamstr-1.siren-macaroni.ts.net:443"] = a[3];
			return { stdout: "" };
		}
		if (a[0] === "serve" && a[1] === "reset") {
			state.web = {};
			return { stdout: "" };
		}
		const svc = a.find((x) => x.startsWith("--service="));
		if (svc) state.services.set(svc.slice(10), a[a.length - 1]);
		if (a[1] === "advertise") state.advertised.add(a[2]);
		if (a[1] === "drain") state.advertised.delete(a[2]);
		if (a[1] === "clear") {
			state.services.delete(a[2]);
			state.advertised.delete(a[2]);
		}
		return { stdout: "" };
	};
	const reply = (status: number, body: unknown = {}) => new Response(JSON.stringify(body), { status });
	const fakeFetch = async (url: any, init: any = {}) => {
		const u = new URL(String(url));
		calls.push(`${init.method ?? "GET"} ${u.pathname}`);
		if (u.pathname.endsWith("/oauth/token")) {
			const pair = Buffer.from(init.headers.authorization.slice(6), "base64").toString();
			if (pair !== `kClientId1:${SECRET}`) return reply(401, { message: "invalid client" });
			return reply(200, { access_token: "tok", expires_in: 3600, scope: opts.scope ?? "devices:core auth_keys services" });
		}
		const name = decodeURIComponent(u.pathname.split("/services/")[1] ?? "");
		if (init.method === "PUT") {
			defs.set(name, JSON.parse(init.body));
			return reply(200, JSON.parse(init.body));
		}
		if (init.method === "DELETE") return defs.delete(name) ? reply(200) : reply(404);
		return reply(200, { vipServices: [...defs.values()] });
	};
	const logs: string[] = [];
	const tailnet = createTailnet({
		db,
		socket,
		upstream: UP,
		hostname: "hamstr",
		tmpDir: tmp,
		crumbs: () => crumbs,
		error: (status, message) => new Failed(status, message),
		run,
		fetch: fakeFetch as any,
		log: (m) => logs.push(m),
		syncEveryMs: 3_600_000,
	});
	return { db, tailnet, state, defs, calls, crumbs, logs, tmp, socket };
}

describe("tailnet: Hamstr's own machine", () => {
	it("is off until connected, and says whether this install has Tailscale", async () => {
		const w = world();
		const s = await w.tailnet.status();
		assert.equal(s.available, true);
		assert.equal(s.state, "off");
		assert.deepEqual(s.tags, ["tag:server", "tag:container"]);
		assert.equal(w.tailnet.domain, "");
		rmSync(w.socket);
		assert.equal((await w.tailnet.status()).available, false);
		await assert.rejects(w.tailnet.connect({ clientId: "kClientId1", clientSecret: SECRET }), (e: any) => e.status === 409);
		w.tailnet.close();
	});

	it("checks the client, logs in with the secret from a file, serves the shell and one service per crumb", async () => {
		const w = world();
		const s = await w.tailnet.connect({ clientId: "kClientId1", clientSecret: SECRET });
		assert.equal(s.state, "running", s.error);
		assert.equal(s.shell, "hamstr-1.siren-macaroni.ts.net");
		assert.equal(s.domain, "siren-macaroni.ts.net");
		assert.equal(s.services, 2);
		assert.deepEqual(w.state.keys, [`${SECRET}?ephemeral=false&preauthorized=true`], "a tagged, preauthorized, permanent machine");
		assert.deepEqual(w.state.tags, ["tag:server", "tag:container"]);
		assert.deepEqual(readdirSync(w.tmp), [], "the key file is gone");
		assert.equal(w.state.web["hamstr-1.siren-macaroni.ts.net:443"], UP);
		assert.deepEqual([...w.state.services.keys()].sort(), ["svc:crumb-aaaaaaaaaaa1", "svc:crumb-aaaaaaaaaaa2"]);
		assert.deepEqual([...w.state.advertised].sort(), ["svc:crumb-aaaaaaaaaaa1", "svc:crumb-aaaaaaaaaaa2"]);
		for (const d of w.defs.values()) assert.deepEqual(d.tags, ["tag:container"]);
		assert.equal(w.tailnet.domain, "siren-macaroni.ts.net");
		assert.equal(w.tailnet.shell, "hamstr-1.siren-macaroni.ts.net");
		// Stored for the next start, but never handed back.
		assert.equal(JSON.parse(String(w.db.prepare("SELECT value FROM settings WHERE key = 'tailnet'").get()!.value)).clientSecret, SECRET);
		assert.ok(!JSON.stringify(s).includes(SECRET));
		w.tailnet.close();
	});

	it("follows crumbs as they come and go, without logging in again", async () => {
		const w = world();
		await w.tailnet.connect({ clientId: "kClientId1", clientSecret: SECRET });
		w.crumbs.pop();
		w.crumbs.push({ id: "aaaaaaaaaaa3" });
		await w.tailnet.sync();
		assert.deepEqual([...w.state.services.keys()].sort(), ["svc:crumb-aaaaaaaaaaa1", "svc:crumb-aaaaaaaaaaa3"]);
		assert.ok(!w.defs.has("svc:crumb-aaaaaaaaaaa2"), "its own definition is deleted");
		assert.equal(w.state.keys.length, 1);
		const before = w.calls.filter((c) => c.startsWith("serve --bg")).length;
		await w.tailnet.sync();
		assert.equal(w.calls.filter((c) => c.startsWith("serve --bg")).length, before, "the shell is not served again");
		w.tailnet.close();
	});

	it("logs in again if the machine was logged out", async () => {
		const w = world();
		await w.tailnet.connect({ clientId: "kClientId1", clientSecret: SECRET });
		w.state.backend = "NeedsLogin";
		await w.tailnet.sync();
		assert.equal(w.state.backend, "Running");
		assert.equal(w.state.keys.length, 2);
		w.tailnet.close();
	});

	it("refuses bad input and says what the client lacks", async () => {
		const w = world();
		const status = async (input: any) => {
			try {
				await w.tailnet.connect(input);
				return 200;
			} catch (e: any) {
				return [e.status, e.message];
			}
		};
		assert.equal((await status({ clientId: "", clientSecret: SECRET }))[0], 400);
		assert.equal((await status({ clientId: "kClientId1", clientSecret: "hunter2" }))[0], 400);
		assert.equal((await status({ clientId: "kClientId1", clientSecret: SECRET, tags: "tag:ok, not-a-tag" }))[0], 400);
		assert.equal((await status({ clientId: "kClientId2", clientSecret: SECRET }))[0], 400, "Tailscale says no");
		assert.equal(w.state.keys.length, 0, "nothing logged in");
		const narrow = world({ scope: "devices:core auth_keys" });
		assert.match((await (async () => narrow.tailnet.connect({ clientId: "kClientId1", clientSecret: SECRET }).catch((e) => e.message))()) as string, /Services/);
		const refused = world({ refuseTags: true });
		const err = await refused.tailnet.connect({ clientId: "kClientId1", clientSecret: SECRET }).catch((e) => e);
		assert.equal(err.status, 400);
		assert.match(err.message, /requested tags/);
		assert.equal((await refused.tailnet.status()).configured, false, "not saved");
		assert.deepEqual(readdirSync(refused.tmp), []);
		for (const x of [w, narrow, refused]) x.tailnet.close();
	});

	it("keeps the saved secret when only the tags change, and logs in afresh for them", async () => {
		const w = world();
		await w.tailnet.connect({ clientId: "kClientId1", clientSecret: SECRET });
		const s = await w.tailnet.connect({ clientId: "kClientId1", clientSecret: "", tags: "tag:server, tag:container, tag:hamstr" });
		assert.equal(s.state, "running");
		assert.deepEqual(w.state.tags, ["tag:server", "tag:container", "tag:hamstr"]);
		assert.ok(w.calls.includes("logout"));
		w.tailnet.close();
	});

	it("turning off removes its services, the shell and the machine", async () => {
		const w = world();
		await w.tailnet.connect({ clientId: "kClientId1", clientSecret: SECRET });
		const s = await w.tailnet.disconnect();
		assert.equal(s.state, "off");
		assert.equal(w.state.services.size, 0);
		assert.equal(w.defs.size, 0);
		assert.deepEqual(w.state.web, {});
		assert.equal(w.state.backend, "NeedsLogin");
		assert.equal(w.db.prepare("SELECT value FROM settings WHERE key = 'tailnet'").get(), undefined);
		assert.equal(w.tailnet.domain, "");
		w.tailnet.close();
	});
});
