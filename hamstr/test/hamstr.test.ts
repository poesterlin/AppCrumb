// Hamstr against a mock IdP, a mock celld node and a real AppCrumb.
// Run: npm test --prefix hamstr
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createStore } from "../../store/server.ts";
import { bundle, call, manifest } from "../../store/test/helpers.ts";
import { crumbPolicy } from "../lib/proxy.ts";
import { createHamstr, siteOf } from "../server.ts";
import { Browser, mockCelld, mockIdp } from "./helpers.ts";

const SHELL = "hamstr.test";
const ORIGIN = { origin: `http://${SHELL}` };
const ADA = { sub: "u-ada", email: "ada@example.com", name: "Ada Lovelace", username: "ada" };
const BOB = { sub: "u-bob", email: "bob@example.com", name: "Bob Builder", username: "bob" };
const EVE = { sub: "u-eve", email: "eve@example.com", name: "Eve", username: "eve" };
const ROLES = {
	permissions: [{ id: "pin" }, { id: "moderate" }],
	roles: [
		{ id: "editor", title: "Can pin", permissions: ["pin"], default: true },
		{ id: "viewer", title: "Can view", permissions: [] },
	],
};

const dir = mkdtempSync(join(tmpdir(), "hamstr-test-"));
let idp;
let celld;
let store;
let storeBase;
let publisherToken;
let hamstr;
let port;

async function publish(over, version = "aaaaaaaaaaaa", files = { "index.html": `<h1>${version}</h1>` }) {
	const m = manifest(over);
	const created = await call(storeBase, `/api/v1/apps/pub/${m.slug}/releases`, { method: "POST", token: publisherToken, json: { manifest: m } });
	assert.equal(created.status, 201, created.text);
	const bytes = await bundle({ version, files });
	const up = await call(storeBase, created.body.upload.url, { method: "PUT", token: publisherToken, body: bytes, headers: { "content-type": "application/gzip" } });
	assert.equal(up.status, 201, up.text);
}

async function signIn(user, next = "/", onPort = port) {
	const browser = new Browser(onPort);
	idp.nextUser = user;
	const start = await browser.request("GET", `/auth/login/${hamstr.core.seededProvider}?next=${encodeURIComponent(next)}`, { host: SHELL });
	assert.equal(start.status, 302);
	const authorize = new URL(start.headers.location);
	assert.equal(authorize.origin, idp.issuer);
	assert.equal(authorize.searchParams.get("code_challenge_method"), "S256");
	const back = await fetch(authorize, { redirect: "manual" });
	const callback = new URL(back.headers.get("location"));
	browser.last = await browser.request("GET", callback.pathname + callback.search, { host: SHELL });
	return browser;
}
const apiCall = (browser: any, method: string, path: string, json?: unknown) => browser.request(method, path, { host: SHELL, headers: ORIGIN, ...(json !== undefined && { json }) });

/** Open a crumb the way the shell does: ticket, then the crumb's enter URL. */
async function enter(browser, crumbId, path = "/") {
	const r = await apiCall(browser, "POST", `/api/crumbs/${crumbId}/open`, { path });
	assert.equal(r.status, 200, r.text);
	return follow(browser, r.json.url);
}
async function follow(browser, absolute) {
	const url = new URL(absolute);
	return browser.request("GET", url.pathname + url.search, { host: url.hostname });
}
const crumbHost = (id) => `crumb-${id}.crumbs.test`;
const sameOrigin = { "sec-fetch-site": "same-origin", "sec-fetch-mode": "cors" };

before(async () => {
	idp = await mockIdp();
	celld = await mockCelld();
	store = createStore({ dataDir: join(dir, "store"), rateLimit: false, logging: false });
	storeBase = `http://127.0.0.1:${(await store.listen(0, "127.0.0.1")).port}`;
	const reg = await call(storeBase, "/api/v1/publishers", { method: "POST", json: { name: "pub", password: "correct horse battery", acceptPolicy: true } });
	publisherToken = reg.body.token;
	await publish({ slug: "board", name: "Board", icon: "📌", ...ROLES });
	await publish({ slug: "plain", name: "Plain", icon: "▫" }, "bbbbbbbbbbbb");
	await publish({ slug: "fetcher", name: "Fetcher", egress: ["api.example.com"] }, "cccccccccccc");
	await publish({ slug: "listener", name: "Listener", devices: ["microphone"] }, "dddddddddddd");
	hamstr = createHamstr({
		dataDir: join(dir, "hamstr"),
		shellHost: SHELL,
		crumbDomain: "crumbs.test",
		scheme: "http",
		store: storeBase,
		celldApi: celld.api,
		adminToken: celld.adminToken,
		proxyToken: celld.proxyToken,
		secret: "test-secret",
		oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret },
		logging: false,
	});
	port = (await hamstr.listen(0, "127.0.0.1")).port;
	// Ada is the first person in, so she owns this Hamstr; the provider then lets
	// everyone else in without waiting (the waiting list has its own test).
	await signIn(ADA);
	hamstr.core.accounts.setProvider("test", hamstr.core.seededProvider, { autoApprove: true });
});

after(async () => {
	await hamstr.close();
	await store.close();
	await celld.close();
	await idp.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("cookie mode", () => {
	it("treats shell and crumbs on one registrable domain as same-site", () => {
		assert.equal(siteOf("hamstr.example.com"), siteOf("crumb-abc.example.com"));
		assert.notEqual(siteOf("hamstr.localhost"), siteOf("crumb-abc.localhost"));
		assert.notEqual(siteOf("hamstr.test"), siteOf("crumb-abc.crumbs.test"));
		assert.equal(siteOf("localhost"), "localhost");
	});
});

describe("hosts and robustness", () => {
	it("answers health, refuses unknown hosts and survives a malformed Host", async () => {
		const b = new Browser(port);
		assert.equal((await b.request("GET", "/api/health", { host: "127.0.0.1:3000" })).status, 200);
		assert.equal((await b.request("GET", "/", { host: "elsewhere.test" })).status, 404);
		assert.equal((await b.request("GET", "/api/health", { host: `${SHELL}:abc` })).status, 200, "no crash");
		assert.equal((await b.request("GET", "/api/health", { host: SHELL })).status, 200);
	});
	it("serves its own static assets without taking the server down", async () => {
		// adapter-node answers these itself (it returns nothing), while pages go
		// through SvelteKit (it returns a promise). Both must stay in the context.
		const b = new Browser(port);
		// The shared design system (copied from packages/ui) and the shell's own styles.
		const ui = await b.request("GET", "/ui.css", { host: SHELL });
		assert.equal(ui.status, 200);
		assert.match(ui.headers["content-type"], /text\/css/);
		assert.match(ui.text, /\.crumb-frame/);
		const css = await b.request("GET", "/shell.css", { host: SHELL });
		assert.equal(css.status, 200);
		assert.match(css.text, /\.tiles/);
		assert.equal((await b.request("GET", "/favicon.svg", { host: SHELL })).status, 200);
		const page = await b.request("GET", "/", { host: SHELL });
		const asset = /\/_app\/immutable\/[^"' ]+\.js/.exec(page.text);
		assert.ok(asset, "the page references its JS bundle");
		assert.equal((await b.request("GET", asset[0], { host: SHELL })).status, 200);
		assert.equal((await b.request("GET", "/api/health", { host: SHELL })).status, 200, "still alive");
	});
	it("serves the shell to signed-out visitors but no data", async () => {
		const b = new Browser(port);
		const page = await b.request("GET", "/", { host: SHELL });
		assert.equal(page.status, 200);
		assert.match(page.headers["content-security-policy"], /frame-ancestors 'none'/);
		assert.match(page.headers["content-security-policy"], /frame-src http:\/\/\*\.crumbs\.test/);
		assert.match(page.headers["content-security-policy"], /form-action 'self'(;|$)/);
		assert.equal((await b.request("GET", "/api/me", { host: SHELL })).status, 401);
	});
});

describe("sign-in", () => {
	it("signs in with PKCE and a checked ID token, then returns to `next`", async () => {
		const ada = await signIn(ADA, "/apps");
		assert.equal(ada.last.status, 303, ada.last.headers.location);
		assert.equal(ada.last.headers.location, "/apps");
		assert.match(ada.last.headers["set-cookie"][0], /HttpOnly; SameSite=Lax/);
		const me = await ada.request("GET", "/api/me", { host: SHELL });
		assert.equal(me.json.user.name, "Ada Lovelace");
		assert.equal(me.json.user.admin, true);
		const bob = await signIn(BOB);
		assert.equal((await bob.request("GET", "/api/me", { host: SHELL })).json.user.admin, false);
	});
	it("refuses tampered tokens and replayed or unknown state", async () => {
		// The ID token comes straight from the token endpoint, so (as OIDC Core 3.1.3.7
		// allows) its signature is not what is checked; its claims are.
		for (const tamper of ["nonce", "aud", "expired"]) {
			idp.tamper = tamper;
			const b = await signIn(ADA);
			assert.equal(b.last.status, 302, tamper);
			assert.match(b.last.headers.location, /^\/auth\/login\?error=/, tamper);
			assert.equal((await b.request("GET", "/api/me", { host: SHELL })).status, 401, tamper);
		}
		const b = new Browser(port);
		const unknown = await b.request("GET", `/auth/callback/${hamstr.core.seededProvider}?code=x&state=nope`, { host: SHELL });
		assert.match(unknown.headers.location, /^\/auth\/login\?error=/);
	});
	it("puts strangers on the waiting list until an admin lets them in", async () => {
		const accounts = hamstr.core.accounts;
		accounts.setProvider("test", hamstr.core.seededProvider, { autoApprove: false });
		try {
			const stranger = await signIn({ sub: "u-x", email: "x@example.com", name: "X" });
			assert.equal(stranger.last.headers.location, "/auth/pending");
			assert.equal((await stranger.request("GET", "/api/me", { host: SHELL })).status, 401);
			const ada = await signIn(ADA);
			const waiting = (await apiCall(ada, "GET", "/api/admin/people")).json.people.find((p) => p.name === "X");
			assert.equal(waiting.status, "pending");
			assert.equal((await apiCall(ada, "PATCH", `/api/admin/people/${waiting.id}`, { status: "active" })).status, 200);
			const again = await signIn({ sub: "u-x", email: "x@example.com", name: "X" });
			assert.equal((await again.request("GET", "/api/me", { host: SHELL })).json.user.admin, false);
			// A member cannot reach the admin API.
			assert.equal((await apiCall(again, "GET", "/api/admin/people")).status, 403);
		} finally {
			accounts.setProvider("test", hamstr.core.seededProvider, { autoApprove: true });
		}
	});
	it("brings over people who signed in before accounts, keeping their ids", async () => {
		const { DatabaseSync } = await import("node:sqlite");
		const { mkdirSync } = await import("node:fs");
		const oldDir = join(dir, "hamstr-old");
		mkdirSync(oldDir, { recursive: true });
		const old = new DatabaseSync(join(oldDir, "hamstr.db"));
		old.exec("CREATE TABLE users (id TEXT PRIMARY KEY, sub TEXT UNIQUE NOT NULL, name TEXT NOT NULL, email TEXT, login TEXT, created_at TEXT NOT NULL, seen_at TEXT NOT NULL); PRAGMA user_version = 1;");
		old.prepare("INSERT INTO users VALUES ('olduserzed00001', 'u-z', 'Zed', 'z@example.com', 'zed', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')").run();
		old.prepare("INSERT INTO users VALUES ('olduseryan00002', 'u-y', 'Yan', 'y@example.com', 'yan', '2026-02-01T00:00:00Z', '2026-02-01T00:00:00Z')").run();
		old.close();
		const upgraded = createHamstr({
			dataDir: oldDir,
			shellHost: SHELL,
			crumbDomain: "crumbs.test",
			scheme: "http",
			store: storeBase,
			celldApi: celld.api,
			adminToken: celld.adminToken,
			proxyToken: celld.proxyToken,
			secret: "s",
			oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret },
			admins: ["y@example.com"],
			logging: false,
		});
		const upPort = (await upgraded.listen(0, "127.0.0.1")).port;
		try {
			const roles = Object.fromEntries(upgraded.core.accounts.people().map((p) => [p.id, p.role]));
			assert.deepEqual(roles, { olduserzed00001: "owner", olduseryan00002: "admin" });
			const zed = await signIn({ sub: "u-z", email: "z@example.com", name: "Zed" }, "/", upPort);
			const me = (await zed.request("GET", "/api/me", { host: SHELL })).json.user;
			assert.equal(me.id, "olduserzed00001");
			assert.equal(me.admin, true);
		} finally {
			await upgraded.close();
		}
	});
	it("refuses a database written by a newer build", async () => {
		const { DatabaseSync } = await import("node:sqlite");
		const { mkdirSync } = await import("node:fs");
		const newerDir = join(dir, "hamstr-newer");
		mkdirSync(newerDir, { recursive: true });
		const newer = new DatabaseSync(join(newerDir, "hamstr.db"));
		newer.exec("PRAGMA user_version = 99");
		newer.close();
		const upgraded = createHamstr({
			dataDir: newerDir,
			shellHost: SHELL,
			crumbDomain: "crumbs.test",
			scheme: "http",
			store: storeBase,
			celldApi: celld.api,
			adminToken: celld.adminToken,
			proxyToken: celld.proxyToken,
			secret: "s",
			oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret },
			admins: [],
			logging: false,
		});
		await assert.rejects(() => upgraded.listen(0, "127.0.0.1"), /refusing to start on newer data/);
	});
	it("ignores a `next` that leaves the shell", async () => {
		const b = await signIn(BOB, "//evil.example/x");
		assert.equal(b.last.headers.location, "/");
	});
	it("signs out server-side, from the shell only", async () => {
		const b = await signIn(BOB);
		const cross = await b.request("POST", "/auth/logout", { host: SHELL, headers: { origin: "http://evil.test" } });
		assert.equal(cross.status, 403);
		const stolen = b.cookieHeader(SHELL);
		assert.equal((await b.request("POST", "/auth/logout", { host: SHELL, headers: ORIGIN })).status, 303);
		const replay = new Browser(port);
		assert.equal((await replay.request("GET", "/api/me", { host: SHELL, headers: { cookie: stolen } })).status, 401);
	});
});

let ada;
let bob;
let board; // a crumb
describe("apps and crumbs", () => {
	before(async () => {
		ada = await signIn(ADA);
		bob = await signIn(BOB);
	});
	it("lets only admins install, and checks the app boots on a probe site", async () => {
		assert.equal((await apiCall(bob, "POST", "/api/apps", { id: "pub/board" })).status, 403);
		celld.calls.length = 0;
		const r = await apiCall(ada, "POST", "/api/apps", { id: "pub/board" });
		assert.equal(r.status, 200, r.text);
		const seq = celld.calls.map((c) => `${c.method} ${c.path}`);
		assert.deepEqual(seq.slice(0, 2), ["POST /blobs/missing", "PUT /blob"]);
		assert.ok(seq.includes("PUT /code"));
		const probe = celld.calls.find((c) => c.path === "/check").query.host;
		assert.match(probe, /^crumb-probe-[a-z0-9]{8}\.crumbs\.test$/);
		assert.ok(celld.calls.some((c) => c.method === "DELETE" && c.path === "/site" && c.query.id === probe), "probe removed");
		assert.equal(celld.sites.has(probe), false);
		assert.equal((await apiCall(ada, "POST", "/api/apps", { id: "pub/plain" })).status, 200);
	});
	it("refuses an app whose start-up check fails", async () => {
		celld.failCheck = true;
		const r = await apiCall(ada, "POST", "/api/apps", { id: "pub/fetcher", allowEgress: true });
		celld.failCheck = false;
		assert.equal(r.status, 422);
		assert.match(r.json.error, /start-up check/);
	});
	it("needs explicit consent for network access", async () => {
		const r = await apiCall(ada, "POST", "/api/apps", { id: "pub/fetcher" });
		assert.equal(r.status, 403);
		assert.match(r.json.error, /api\.example\.com/);
		assert.equal((await apiCall(ada, "POST", "/api/apps", { id: "pub/fetcher", allowEgress: true })).status, 200);
	});
	it("needs explicit consent for the microphone, and only then lists it", async () => {
		const r = await apiCall(ada, "POST", "/api/apps", { id: "pub/listener" });
		assert.equal(r.status, 403);
		assert.match(r.json.error, /microphone/);
		assert.equal((await apiCall(ada, "POST", "/api/apps", { id: "pub/listener", allowEgress: true })).status, 200);
		const apps = await apiCall(ada, "GET", "/api/apps");
		assert.deepEqual(apps.json.apps.find((a) => a.slug === "listener").devices, ["microphone"]);
		assert.deepEqual(apps.json.apps.find((a) => a.slug === "plain").devices, []);
	});
	it("never lets another publisher's app of the same name replace an installed one", async () => {
		const other = (await call(storeBase, "/api/v1/publishers", { method: "POST", json: { name: "someone", password: "correct horse battery", acceptPolicy: true } })).body.token;
		const m = manifest({ slug: "plain", name: "Plain", icon: "▫", version: "9.0.0" });
		const created = await call(storeBase, "/api/v1/apps/someone/plain/releases", { method: "POST", token: other, json: { manifest: m } });
		await call(storeBase, created.body.upload.url, { method: "PUT", token: other, body: await bundle({ version: "999999999999" }), headers: { "content-type": "application/gzip" } });
		const r = await apiCall(ada, "POST", "/api/apps", { id: "someone/plain" });
		assert.equal(r.status, 409);
		assert.match(r.json.error, /already has an app called Plain \(pub\/plain\)/);
		const apps = (await ada.request("GET", "/api/apps", { host: SHELL })).json.apps;
		assert.equal(apps.find((a) => a.slug === "plain").storeId, "pub/plain");
	});
	it("holds a crumb's browser code to the app's declared hosts", () => {
		const none = crumbPolicy([], "https://shell.test");
		assert.match(none, /connect-src 'self';/);
		assert.match(none, /img-src 'self' data: blob:;/);
		const some = crumbPolicy(["api.example.com"], "https://shell.test");
		assert.match(some, /connect-src 'self' https:\/\/api\.example\.com https:\/\/\*\.api\.example\.com wss:\/\/api\.example\.com;/);
		assert.match(some, /font-src 'self' data:;/, "fonts never come from elsewhere");
		assert.match(some, /frame-ancestors https:\/\/shell\.test$/);
	});
	it("creates a crumb as its own celld site, with the app's egress", async () => {
		celld.calls.length = 0;
		const r = await apiCall(bob, "POST", "/api/crumbs", { slug: "board", title: "Family board" });
		assert.equal(r.status, 201, r.text);
		board = r.json.crumb;
		assert.match(board.id, /^[a-z0-9]{12}$/);
		assert.equal(board.role, "owner");
		assert.deepEqual(board.permissions, ["pin", "moderate"]);
		assert.deepEqual(
			celld.calls.map((c) => `${c.method} ${c.path} ${c.query.host}`),
			[`POST /stage ${crumbHost(board.id)}`, `DELETE /egress ${crumbHost(board.id)}`, `POST /activate ${crumbHost(board.id)}`],
		);
		const f = await apiCall(bob, "POST", "/api/crumbs", { slug: "fetcher", title: "Feeds" });
		assert.ok(celld.calls.some((c) => c.method === "PUT" && c.path === "/egress" && c.body === '["api.example.com"]'));
		const listed = (await bob.request("GET", "/api/crumbs", { host: SHELL })).json;
		assert.deepEqual(listed.mine.map((g) => g.title).sort(), ["Family board", "Feeds"]);
		assert.equal((await ada.request("GET", "/api/crumbs", { host: SHELL })).json.mine.length, 0);
		assert.equal((await ada.request("GET", `/api/crumbs/${f.json.crumb.id}`, { host: SHELL })).status, 404);
	});
	it("refuses cross-origin writes to the shell API", async () => {
		const evil = await bob.request("POST", "/api/crumbs", { host: SHELL, headers: { origin: "http://crumb-x.crumbs.test" }, json: { slug: "board" } });
		assert.equal(evil.status, 403);
		const fetchSite = await bob.request("POST", "/api/crumbs", { host: SHELL, headers: { "sec-fetch-site": "same-site" }, json: { slug: "board" } });
		assert.equal(fetchSite.status, 403);
		const form = await bob.request("POST", "/api/crumbs", { host: SHELL, headers: { ...ORIGIN, "content-type": "text/plain" }, body: "{}" });
		assert.equal(form.status, 415);
	});
	it("opens a single-instance app's one crumb, making it on first open", async () => {
		await publish({ slug: "family", name: "Family", instances: "single" }, "eeeeeeeeeeee");
		assert.equal((await apiCall(ada, "POST", "/api/apps", { id: "pub/family" })).status, 200);
		const apps = (await bob.request("GET", "/api/apps", { host: SHELL })).json.apps;
		assert.equal(apps.find((a) => a.slug === "family").instances, "single");
		assert.equal(apps.find((a) => a.slug === "board").instances, "many");
		// Two taps at once still make one crumb.
		const [a, b] = await Promise.all([apiCall(bob, "POST", "/api/apps/family/open", {}), apiCall(bob, "POST", "/api/apps/family/open", {})]);
		assert.equal(a.status, 201, a.text);
		assert.equal(b.json.crumb.id, a.json.crumb.id);
		assert.equal(a.json.crumb.title, "Family");
		const again = await apiCall(bob, "POST", "/api/apps/family/open", {});
		assert.equal(again.status, 200);
		assert.equal(again.json.crumb.id, a.json.crumb.id);
		// Everyone gets their own; the trash does not count.
		const ada1 = (await apiCall(ada, "POST", "/api/apps/family/open", {})).json.crumb;
		assert.notEqual(ada1.id, a.json.crumb.id);
		await apiCall(ada, "POST", `/api/crumbs/${ada1.id}/trash`, {});
		const ada2 = await apiCall(ada, "POST", "/api/apps/family/open", {});
		assert.equal(ada2.status, 201);
		assert.notEqual(ada2.json.crumb.id, ada1.id);
		// Many-instance apps are opened from their own page instead.
		assert.equal((await apiCall(bob, "POST", "/api/apps/board/open", {})).status, 409);
		assert.equal((await apiCall(bob, "POST", "/api/apps/nope/open", {})).status, 404);
		assert.equal((await bob.request("POST", "/api/apps/family/open", { host: SHELL, headers: { origin: "http://evil.test" }, json: {} })).status, 403);
		for (const g of [ada1, ada2.json.crumb]) {
			await apiCall(ada, "POST", `/api/crumbs/${g.id}/trash`, {});
			assert.equal((await apiCall(ada, "DELETE", `/api/crumbs/${g.id}`)).status, 200);
		}
	});
	it("names a new crumb after its app and shows it on the app's page", async () => {
		const r = await apiCall(bob, "POST", "/api/crumbs", { slug: "plain" });
		assert.equal(r.json.crumb.title, "Untitled Plain");
		const home = await bob.request("GET", "/", { host: SHELL });
		assert.match(home.text, /href="\/a\/plain"/);
		assert.match(home.text, /href="\/a\/family"/);
		const appPage = await bob.request("GET", "/a/plain", { host: SHELL });
		assert.equal(appPage.status, 200);
		assert.ok(appPage.text.includes(`/c/${r.json.crumb.id}`));
		assert.equal((await bob.request("GET", "/apps", { host: SHELL })).headers.location, "/store");
		await apiCall(bob, "POST", `/api/crumbs/${r.json.crumb.id}/trash`, {});
		assert.equal((await apiCall(bob, "DELETE", `/api/crumbs/${r.json.crumb.id}`)).status, 200);
	});
	it("downloads a crumb's data from the app's export path, as the owner only", async () => {
		await publish({ slug: "notes", name: "Notes", export: "/export?all=1" }, "ffffffffffff");
		assert.equal((await apiCall(ada, "POST", "/api/apps", { id: "pub/notes" })).status, 200);
		const apps = (await bob.request("GET", "/api/apps", { host: SHELL })).json.apps;
		assert.equal(apps.find((a) => a.slug === "notes").canExport, true);
		assert.equal(apps.find((a) => a.slug === "plain").canExport, false);
		const g = (await apiCall(bob, "POST", "/api/crumbs", { slug: "notes", title: "Trip: plans/ideas" })).json.crumb;
		const r = await bob.request("GET", `/api/crumbs/${g.id}/export`, { host: SHELL, headers: sameOrigin });
		assert.equal(r.status, 200, r.text);
		assert.match(r.headers["content-disposition"], /^attachment; filename="Trip- plans-ideas \d{4}-\d{2}-\d{2}\.json"; filename\*=UTF-8''/);
		assert.equal(r.headers["x-content-type-options"], "nosniff");
		// What the app saw: its own path, the owner's identity, and the proxy token.
		assert.equal(r.json.host, crumbHost(g.id));
		assert.equal(r.json.path, "/export?all=1");
		assert.equal(r.json.headers["x-hamstr-role"], "owner");
		assert.equal(r.json.headers["x-hamstr-export"], "1");
		assert.match(r.json.headers["x-hamstr-user-id"], /^[a-f0-9]{32}$/);
		assert.equal(r.headers["x-celld-proxy-token"], undefined);
		// Nobody else, not from another site, and not from an app without export.
		assert.equal((await ada.request("GET", `/api/crumbs/${g.id}/export`, { host: SHELL })).status, 404);
		assert.equal((await bob.request("GET", `/api/crumbs/${g.id}/export`, { host: SHELL, headers: { "sec-fetch-site": "cross-site" } })).status, 403);
		const p = (await apiCall(bob, "POST", "/api/crumbs", { slug: "plain" })).json.crumb;
		const none = await bob.request("GET", `/api/crumbs/${p.id}/export`, { host: SHELL });
		assert.equal(none.status, 404);
		assert.match(none.json.error, /can't export/);
		await apiCall(bob, "POST", `/api/crumbs/${g.id}/trash`, {});
		assert.equal((await bob.request("GET", `/api/crumbs/${g.id}/export`, { host: SHELL })).status, 404);
		for (const id of [g.id, p.id]) {
			await apiCall(bob, "POST", `/api/crumbs/${id}/trash`, {});
			assert.equal((await apiCall(bob, "DELETE", `/api/crumbs/${id}`)).status, 200);
		}
	});
	it("shows an app's items and trash on its page", async () => {
		const g = (await apiCall(bob, "POST", "/api/crumbs", { slug: "plain", title: "Old list" })).json.crumb;
		await apiCall(bob, "POST", `/api/crumbs/${g.id}/trash`, {});
		const html = (await bob.request("GET", "/a/plain?tab=trash", { host: SHELL })).text;
		assert.match(html, /Old list/);
		assert.match(html, /Trash <span class="count">1<\/span>/);
		assert.equal((await bob.request("GET", "/a/nope", { host: SHELL })).status, 200);
		assert.match((await bob.request("GET", "/a/nope", { host: SHELL })).text, /not installed/);
		assert.equal((await apiCall(bob, "DELETE", `/api/crumbs/${g.id}`)).status, 200);
	});
	it("shows an app's store details, versions and what it can do", async () => {
		const page = await bob.request("GET", "/store/board", { host: SHELL });
		assert.equal(page.status, 200);
		assert.match(page.text, /<h1>Board<\/h1>/);
		assert.match(page.text, /Installed/);
		const caps = (await bob.request("GET", "/store/board?tab=permissions", { host: SHELL })).text;
		assert.match(caps, /Private to you/);
		assert.match(caps, /No internet access/);
		assert.match((await bob.request("GET", "/store/fetcher?tab=permissions", { host: SHELL })).text, /api\.example\.com/);
		assert.match((await bob.request("GET", "/store/board?tab=versions", { host: SHELL })).text, /v1\.0\.0/);
		assert.match((await bob.request("GET", "/store/nope", { host: SHELL })).text, /not in the store/);
		assert.match((await bob.request("GET", "/store?q=fetch", { host: SHELL })).text, /Fetcher/);
		assert.doesNotMatch((await bob.request("GET", "/store?q=fetch", { host: SHELL })).text, /data-slug="plain"/);
	});
	it("refuses to remove an app that still has crumbs", async () => {
		const r = await apiCall(ada, "DELETE", "/api/apps/board");
		assert.equal(r.status, 409);
	});
});

describe("the crumb proxy", () => {
	it("enters with a one-time ticket and forwards trusted identity only", async () => {
		const entered = await enter(bob, board.id, "/notes?x=1");
		assert.equal(entered.status, 303);
		assert.equal(entered.headers.location, "/notes?x=1");
		// hamstr.test and crumbs.test are different sites: a partitioned cookie.
		assert.match(entered.headers["set-cookie"][0], /^hamstr_crumb=.*HttpOnly; SameSite=None; Secure; Partitioned/);
		const r = await bob.request("GET", "/notes?x=1", {
			host: crumbHost(board.id),
			headers: { "x-hamstr-user-id": "forged", "x-hamstr-permissions": "moderate,admin", "x-celld-proxy-token": "guess", cookie: `${bob.cookieHeader(crumbHost(board.id))}; app=1` },
		});
		assert.equal(r.status, 200, r.text);
		const h = r.json.headers;
		assert.equal(h["x-hamstr-role"], "owner");
		assert.equal(h["x-hamstr-permissions"], "pin,moderate");
		assert.equal(decodeURIComponent(h["x-hamstr-username"]), "Bob Builder");
		assert.match(h["x-hamstr-user-id"], /^[a-f0-9]{32}$/);
		assert.notEqual(h["x-hamstr-user-id"], "forged");
		assert.equal(h["x-hamstr-crumb-id"], board.id);
		assert.equal(h.cookie, "app=1", "the crumb session cookie never reaches the app");
		assert.equal(h["x-forwarded-proto"], "http");
		// Hamstr's policy: framed by the shell only, and the page's code can reach
		// nothing beyond the crumb itself (this app declares no hosts).
		const policy = r.headers["content-security-policy"];
		assert.match(policy, new RegExp(`frame-ancestors http://${SHELL.replace(/\./g, "\\.")}$`));
		assert.match(policy, /connect-src 'self';/);
		assert.match(policy, /script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:;/);
		assert.match(policy, /font-src 'self' data:;/);
	});
	it("passes a crumb's 304 through without dying", async () => {
		await enter(bob, board.id);
		const host = crumbHost(board.id);
		const r = await bob.request("GET", "/not-modified", { host, headers: { cookie: bob.cookieHeader(host), "if-none-match": '"v1"' } });
		assert.equal(r.status, 304);
		assert.equal(r.headers.etag, '"v1"');
		const again = await bob.request("GET", "/notes", { host, headers: { cookie: bob.cookieHeader(host) } });
		assert.equal(again.status, 200, "the server is still up");
	});
	it("does not accept a ticket twice, or on another crumb", async () => {
		const r = await apiCall(bob, "POST", `/api/crumbs/${board.id}/open`, { path: "/" });
		const url = new URL(r.json.url);
		const thief = new Browser(port);
		const other = await apiCall(bob, "POST", "/api/crumbs", { slug: "plain", title: "Other" });
		assert.equal((await thief.request("GET", url.pathname + url.search, { host: crumbHost(other.json.crumb.id) })).status, 403);
		const once = new Browser(port);
		assert.equal((await once.request("GET", url.pathname + url.search, { host: url.hostname })).status, 403, "ticket burned by the failed attempt");
	});
	it("sends visitors without a crumb session back to the shell", async () => {
		const b = new Browser(port);
		const nav = await b.request("GET", "/deep/link", { host: crumbHost(board.id), headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document", "sec-fetch-site": "none" } });
		assert.equal(nav.status, 303);
		assert.equal(nav.headers.location, `http://${SHELL}/c/${board.id}/open?path=${encodeURIComponent("/deep/link")}`);
		const frame = await b.request("GET", "/", { host: crumbHost(board.id), headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "iframe", "sec-fetch-site": "same-site" } });
		assert.equal(frame.status, 401);
		assert.match(frame.text, /target="_top"/);
		assert.equal((await b.request("GET", "/api/data", { host: crumbHost(board.id) })).status, 401);
		// The top-level open path issues a ticket for a signed-in owner.
		const open = await bob.request("GET", `/c/${board.id}/open?path=%2Fdeep%2Flink`, { host: SHELL });
		assert.equal(open.status, 303);
		assert.match(open.headers.location, new RegExp(`^http://${crumbHost(board.id)}/\\.hamstr/enter\\?ticket=`));
		const anon = await b.request("GET", `/c/${board.id}/open`, { host: SHELL });
		assert.match(anon.headers.location, /^\/auth\/login\?next=/);
	});
	it("keeps other origins, including other crumbs, from scripting a crumb", async () => {
		const host = crumbHost(board.id);
		const sub = await bob.request("GET", "/api/data", { host, headers: { "sec-fetch-site": "same-site", "sec-fetch-mode": "no-cors" } });
		assert.equal(sub.status, 403);
		const post = await bob.request("POST", "/pin", { host, headers: { "sec-fetch-site": "same-site", "sec-fetch-mode": "navigate" }, body: "text=hi" });
		assert.equal(post.status, 403);
		const legacy = await bob.request("POST", "/pin", { host, headers: { origin: "http://crumb-other.crumbs.test" }, body: "text=hi" });
		assert.equal(legacy.status, 403);
		const own = await bob.request("POST", "/pin", { host, headers: { ...sameOrigin, origin: `http://${host}` }, body: "text=hi" });
		assert.equal(own.status, 200);
		assert.equal(own.json.body, "text=hi");
		const link = await bob.request("GET", "/", { host, headers: { "sec-fetch-site": "cross-site", "sec-fetch-mode": "navigate" } });
		assert.equal(link.status, 200, "a plain link from elsewhere still opens the crumb");
	});
	it("lets a crumb set cookies for itself only", async () => {
		const r = await bob.request("GET", "/setcookie", { host: crumbHost(board.id) });
		assert.deepEqual(r.headers["set-cookie"], ["app=1; Path=/"]);
		// The app's own policy stays, next to Hamstr's: the browser enforces both.
		assert.match(r.headers["content-security-policy"], new RegExp(`^default-src 'self', default-src 'self'; .*frame-ancestors http://${SHELL.replace(/\./g, "\\.")}$`));
	});
	it("ends crumb sessions when the shell session signs out", async () => {
		const carol = await signIn(BOB);
		await enter(carol, board.id);
		assert.equal((await carol.request("GET", "/", { host: crumbHost(board.id) })).status, 200);
		await carol.request("POST", "/auth/logout", { host: SHELL, headers: ORIGIN });
		assert.equal((await carol.request("GET", "/", { host: crumbHost(board.id) })).status, 401);
	});
});

describe("privacy", () => {
	it("keeps an item to its owner: others cannot list, open, change or download it", async () => {
		const eve = await signIn(EVE);
		assert.equal((await eve.request("GET", "/api/crumbs", { host: SHELL })).json.mine.length, 0);
		assert.equal((await eve.request("GET", `/api/crumbs/${board.id}`, { host: SHELL })).status, 404);
		assert.equal((await apiCall(eve, "POST", `/api/crumbs/${board.id}/open`, { path: "/" })).status, 404);
		assert.equal((await apiCall(eve, "PATCH", `/api/crumbs/${board.id}`, { title: "Mine now" })).status, 404);
		assert.equal((await apiCall(eve, "POST", `/api/crumbs/${board.id}/trash`, {})).status, 404);
		assert.equal((await eve.request("GET", `/api/crumbs/${board.id}/export`, { host: SHELL })).status, 404);
		assert.equal((await eve.request("GET", "/", { host: crumbHost(board.id) })).status, 401);
		assert.match((await eve.request("GET", `/c/${board.id}`, { host: SHELL })).text, /Nothing here/);
	});
	it("has no share links any more", async () => {
		assert.equal((await apiCall(bob, "POST", `/api/crumbs/${board.id}/shares`, { role: "viewer" })).status, 404);
		assert.equal((await new Browser(port).request("GET", `/s/${"a".repeat(32)}`, { host: SHELL })).status, 404);
		assert.equal((await bob.request("GET", "/shared", { host: SHELL })).status, 404);
		assert.equal((await bob.request("GET", "/api/crumbs", { host: SHELL })).json.shared, undefined);
	});
});

describe("trash and updates", () => {
	it("hides a trashed crumb, restores it, and deletes it for good", async () => {
		const g = (await apiCall(bob, "POST", "/api/crumbs", { slug: "plain", title: "Scratch" })).json.crumb;
		await enter(bob, g.id);
		assert.equal((await apiCall(bob, "DELETE", `/api/crumbs/${g.id}`)).status, 409, "trash first");
		assert.equal((await apiCall(bob, "POST", `/api/crumbs/${g.id}/trash`, {})).status, 200);
		assert.equal((await bob.request("GET", "/", { host: crumbHost(g.id) })).status, 404);
		const lists = (await bob.request("GET", "/api/crumbs", { host: SHELL })).json;
		assert.ok(lists.trash.some((t) => t.id === g.id));
		assert.ok(!lists.mine.some((t) => t.id === g.id));
		assert.equal((await apiCall(bob, "POST", `/api/crumbs/${g.id}/restore`, {})).status, 200);
		await apiCall(bob, "POST", `/api/crumbs/${g.id}/trash`, {});
		assert.equal((await apiCall(bob, "DELETE", `/api/crumbs/${g.id}`)).status, 200);
		assert.equal(celld.sites.has(crumbHost(g.id)), false);
		assert.equal((await bob.request("GET", `/api/crumbs/${g.id}`, { host: SHELL })).status, 404);
	});
	it("moves every crumb to a new release and ignores retired roles", async () => {
		await publish({ slug: "board", name: "Board", icon: "📌", version: "1.1.0", ...ROLES }, "dddddddddddd");
		const updates = await ada.request("GET", "/api/apps/updates", { host: SHELL });
		assert.equal(updates.json.updates.board.version, "1.1.0");
		const r = await apiCall(ada, "POST", "/api/apps", { id: "pub/board" });
		assert.equal(r.status, 200, r.text);
		assert.equal(r.json.updatedCrumbs, 1);
		assert.equal(celld.sites.get(crumbHost(board.id)), "dddddddddddd");
		const g = (await bob.request("GET", `/api/crumbs/${board.id}`, { host: SHELL })).json.crumb;
		assert.equal(g.role, "owner");
	});
	it("renames crumbs for their owner", async () => {
		const r = await apiCall(bob, "PATCH", `/api/crumbs/${board.id}`, { title: "  Kitchen board  " });
		assert.equal(r.json.crumb.title, "Kitchen board");
		assert.equal((await apiCall(bob, "PATCH", `/api/crumbs/${board.id}`, { title: " " })).status, 400);
	});
	it("resets an item to empty, keeping the item, and puts the data back if that fails", async () => {
		const host = crumbHost(board.id);
		const reset = (browser: any, body: any = { confirm: board.id }, headers: Record<string, string> = {}) => browser.request("POST", `/api/crumbs/${board.id}/reset`, { host: SHELL, headers: { ...ORIGIN, ...headers }, json: body });
		celld.data.set(host, "precious");
		// Refused before anything changes: not the owner, no confirmation, wrong item, cross-origin.
		assert.equal((await reset(ada)).status, 404);
		assert.equal((await reset(bob, {})).status, 400);
		assert.equal((await reset(bob, { confirm: "someone-else" })).status, 400);
		assert.equal((await reset(bob, { confirm: board.id }, { origin: "http://evil.test" })).status, 403);
		assert.equal(celld.data.get(host), "precious");

		// A reset that fails after the wipe puts the data back.
		celld.failActivate = host;
		const failed = await reset(bob);
		assert.equal(failed.status, 502);
		assert.match(failed.json.error, /put back as it was/);
		assert.equal(celld.data.get(host), "precious");
		assert.equal(celld.sites.has(host), true);

		const ok = await reset(bob);
		assert.equal(ok.status, 200, ok.text);
		assert.equal(celld.data.has(host), false, "the data is gone");
		assert.equal(celld.sites.has(host), true, "the item runs again, on its app's code");
		const crumbs = (await bob.request("GET", "/api/crumbs", { host: SHELL })).json.mine;
		assert.equal(crumbs.find((g) => g.id === board.id)?.title, "Kitchen board", "the item itself stays");
	});
	it("backs up any item and restores it, putting it back if a restore fails", async () => {
		const host = crumbHost(board.id);
		const upload = (browser, path, body, headers = {}) =>
			browser.request(path.endsWith("/import") ? "POST" : "PUT", path, { host: SHELL, headers: { ...ORIGIN, "content-type": "application/octet-stream", ...headers }, body });
		celld.data.set(host, "version one");
		const down = await bob.request("GET", `/api/crumbs/${board.id}/backup`, { host: SHELL });
		assert.equal(down.status, 200, down.text);
		assert.match(down.headers["content-disposition"], /^attachment; filename="Kitchen board \d{4}-\d\d-\d\d\.hamstr-backup"/);
		const [head, ...rest] = down.text.trim().split("\n").map((l) => JSON.parse(l));
		assert.deepEqual([head.type, head.app, head.appVersion, head.title], ["hamstr-backup", "board", "1.1.0", "Kitchen board"]);
		assert.deepEqual(rest.map((l) => l.type), ["celld-dump", "note", "end"]);
		assert.equal((await ada.request("GET", `/api/crumbs/${board.id}/backup`, { host: SHELL })).status, 404, "owner only");
		assert.equal((await bob.request("GET", `/api/crumbs/${board.id}/backup`, { host: SHELL, headers: { "sec-fetch-site": "cross-site" } })).status, 403);

		celld.data.set(host, "changed later");
		const r = await upload(bob, `/api/crumbs/${board.id}/backup`, down.text);
		assert.equal(r.status, 200, r.text);
		assert.equal(celld.data.get(host), "version one");

		// Refused before anything changes.
		const swap = (patch) => [JSON.stringify({ ...head, ...patch }), ...down.text.trim().split("\n").slice(1)].join("\n");
		assert.equal((await upload(bob, `/api/crumbs/${board.id}/backup`, swap({ appVersion: "9.0.0" }))).status, 409, "made by a newer app");
		assert.match((await upload(bob, `/api/crumbs/${board.id}/backup`, swap({ app: "plain", appName: "Plain" }))).json.error, /backup of Plain, not Board/);
		assert.equal((await upload(bob, `/api/crumbs/${board.id}/backup`, "hello\n")).status, 422);
		assert.equal((await upload(ada, `/api/crumbs/${board.id}/backup`, down.text)).status, 404, "owner only");
		assert.equal((await upload(bob, `/api/crumbs/${board.id}/backup`, down.text, { origin: "http://evil.test" })).status, 403);
		assert.equal((await upload(bob, `/api/crumbs/${board.id}/backup`, down.text, { "content-type": "text/plain" })).status, 415);
		assert.equal(celld.data.get(host), "version one");

		// A restore that fails half-way puts the item back.
		celld.data.set(host, "current");
		celld.failRestore = host;
		const failed = await upload(bob, `/api/crumbs/${board.id}/backup`, down.text);
		assert.equal(failed.status, 422);
		assert.match(failed.json.error, /put back as it was/);
		assert.equal(celld.data.get(host), "current");

		// Importing makes a new item from the backup.
		const made = await upload(bob, "/api/apps/board/import", down.text);
		assert.equal(made.status, 201, made.text);
		assert.equal(made.json.crumb.title, "Kitchen board");
		assert.notEqual(made.json.crumb.id, board.id);
		assert.equal(celld.data.get(crumbHost(made.json.crumb.id)), "version one");
		const before = celld.sites.size;
		assert.equal((await upload(bob, "/api/apps/plain/import", down.text)).status, 422);
		assert.equal(celld.sites.size, before, "a refused import leaves no crumb behind");
		await apiCall(bob, "POST", `/api/crumbs/${made.json.crumb.id}/trash`, {});
		assert.equal((await apiCall(bob, "DELETE", `/api/crumbs/${made.json.crumb.id}`)).status, 200);
	});
	it("uninstalls an app for everyone, deleting its items only when told to", async () => {
		const bobs = (await apiCall(bob, "POST", "/api/apps/family/open", {})).json.crumb;
		const adas = (await apiCall(ada, "POST", "/api/apps/family/open", {})).json.crumb;
		await apiCall(ada, "POST", `/api/crumbs/${adas.id}/trash`, {});
		const info = await ada.request("GET", "/api/apps/family", { host: SHELL });
		assert.deepEqual(info.json.usage, { items: 2, mine: 1, others: 1, people: 2 });
		assert.equal((await apiCall(bob, "DELETE", "/api/apps/family?items=delete")).status, 403, "admins only");
		assert.equal((await ada.request("DELETE", "/api/apps/family?items=delete", { host: SHELL, headers: { origin: "http://evil.test" } })).status, 403);
		const kept = await apiCall(ada, "DELETE", "/api/apps/family");
		assert.equal(kept.status, 409);
		assert.match(kept.json.error, /2 items/);
		assert.ok(celld.sites.has(crumbHost(bobs.id)));
		const r = await apiCall(ada, "DELETE", "/api/apps/family?items=delete");
		assert.equal(r.status, 200, r.text);
		assert.equal(r.json.deleted, 2);
		for (const g of [bobs, adas]) assert.equal(celld.sites.has(crumbHost(g.id)), false);
		assert.equal((await bob.request("GET", `/api/crumbs/${bobs.id}`, { host: SHELL })).status, 404);
		assert.equal((await bob.request("GET", "/api/apps/family", { host: SHELL })).status, 404);
		assert.doesNotMatch((await bob.request("GET", "/", { host: SHELL })).text, /href="\/a\/family"/);
		assert.equal((await apiCall(ada, "DELETE", "/api/apps/family")).status, 404);
		// Bob's Feeds goes with Fetcher.
		assert.equal((await apiCall(ada, "DELETE", "/api/apps/fetcher?items=delete")).status, 200);
	});
});

describe("stores settings", () => {
	it("seeds HAMSTR_STORE, lets an admin register and switch the active one, and refuses members", async () => {
		const ada = await signIn(ADA);
		const bob = await signIn(BOB);
		const listed = await apiCall(ada, "GET", "/api/admin/stores");
		assert.equal(listed.status, 200, listed.text);
		assert.equal(listed.json.stores.length, 1);
		assert.equal(listed.json.stores[0].url, storeBase);
		assert.equal(listed.json.stores[0].active, true);
		assert.equal((await apiCall(bob, "GET", "/api/admin/stores")).status, 403);

		const other = createStore({ dataDir: join(dir, "store-other"), rateLimit: false, logging: false });
		const otherBase = `http://127.0.0.1:${(await other.listen(0, "127.0.0.1")).port}`;
		try {
			const created = await apiCall(ada, "POST", "/api/admin/stores", { url: otherBase, name: "Other" });
			assert.equal(created.status, 200, created.text);
			assert.equal(created.json.store.url, otherBase);
			assert.equal(created.json.store.active, false);
			assert.equal(hamstr.core.activeStore().url, storeBase);

			const activated = await apiCall(ada, "PATCH", `/api/admin/stores/${created.json.store.id}`, { active: true });
			assert.equal(activated.status, 200, activated.text);
			assert.equal(hamstr.core.activeStore().url, otherBase);
			assert.equal(hamstr.core.storesList().filter((s) => s.active).length, 1);

			// Market calls follow the active store (empty other catalog).
			const market = await apiCall(ada, "GET", "/api/market?limit=5");
			assert.equal(market.status, 200, market.text);
			assert.equal(market.json.apps?.length ?? 0, 0);

			assert.equal((await apiCall(ada, "DELETE", `/api/admin/stores/${created.json.store.id}`)).status, 200);
			assert.equal(hamstr.core.activeStore().url, storeBase);
			const back = await apiCall(ada, "GET", "/api/market?limit=5");
			assert.ok((back.json.apps?.length ?? 0) > 0, back.text);
		} finally {
			await other.close();
			const left = hamstr.core.storesList();
			if (!left.some((s) => s.url === storeBase)) {
				hamstr.core.saveStore("test", { url: storeBase, active: true });
			} else if (!hamstr.core.activeStore() || hamstr.core.activeStore().url !== storeBase) {
				hamstr.core.activateStore("test", left.find((s) => s.url === storeBase).id);
			}
			for (const s of hamstr.core.storesList()) {
				if (s.url !== storeBase) hamstr.core.deleteStore("test", s.id);
			}
		}
	});

	it("updates an installed app from the store it came from after switching the active store", async () => {
		const ada = await signIn(ADA);
		const source = hamstr.core.activeStore();
		assert.ok(source);
		assert.equal(source.url, storeBase);
		const apps = (await apiCall(ada, "GET", "/api/apps")).json.apps;
		assert.equal(apps.find((a) => a.slug === "board").sourceStore, source.id);

		const other = createStore({ dataDir: join(dir, "store-source-other"), rateLimit: false, logging: false });
		const otherBase = `http://127.0.0.1:${(await other.listen(0, "127.0.0.1")).port}`;
		try {
			const created = await apiCall(ada, "POST", "/api/admin/stores", { url: otherBase, name: "Empty", active: true });
			assert.equal(created.status, 200, created.text);
			assert.equal(hamstr.core.activeStore().url, otherBase);
			assert.equal((await apiCall(ada, "GET", "/api/market?limit=5")).json.apps?.length ?? 0, 0);

			await publish({ slug: "board", name: "Board", icon: "📌", version: "1.2.0", ...ROLES }, "121212121212");
			const updates = await ada.request("GET", "/api/apps/updates", { host: SHELL });
			assert.equal(updates.json.updates.board.version, "1.2.0", updates.text);
			const detail = await apiCall(ada, "GET", "/api/market/pub/board");
			assert.equal(detail.status, 200, detail.text);
			assert.equal(detail.json.app.id, "pub/board");
			const r = await apiCall(ada, "POST", "/api/apps", { id: "pub/board" });
			assert.equal(r.status, 200, r.text);
			assert.equal(r.json.app.version, "1.2.0");
			assert.equal(r.json.app.sourceStore, source.id);
			assert.equal(celld.sites.get(crumbHost(board.id)), "121212121212");
		} finally {
			await other.close();
			hamstr.core.activateStore("test", source.id);
			for (const s of hamstr.core.storesList()) {
				if (s.id !== source.id) hamstr.core.deleteStore("test", s.id);
			}
		}
	});

	it("seeds only once, and an empty list means no store", async () => {
		const dataDir = join(dir, "hamstr-stores-seed");
		const opts = {
			dataDir,
			shellHost: SHELL,
			crumbDomain: "crumbs.test",
			scheme: "http",
			celldApi: celld.api,
			adminToken: celld.adminToken,
			proxyToken: celld.proxyToken,
			secret: "test-secret-stores",
			oidc: { issuer: idp.issuer, clientId: idp.clientId, clientSecret: idp.clientSecret },
			logging: false,
		};
		const a = createHamstr({ ...opts, store: storeBase, storePublic: `${storeBase}/public` });
		await a.listen(0, "127.0.0.1");
		try {
			const first = a.core.storesList();
			assert.equal(first.length, 1);
			assert.equal(first[0].url, storeBase);
			assert.equal(first[0].publicUrl, `${storeBase}/public`);
			a.core.saveStore("test", { id: first[0].id, url: storeBase, name: "Renamed" });
		} finally {
			await a.close();
		}
		const b = createHamstr({ ...opts, store: "http://ignored.example" });
		await b.listen(0, "127.0.0.1");
		try {
			const again = b.core.storesList();
			assert.equal(again.length, 1);
			assert.equal(again[0].name, "Renamed");
			assert.equal(again[0].url, storeBase);
			b.core.deleteStore("test", again[0].id);
			assert.equal(b.core.activeStore(), null);
			await assert.rejects(() => b.core.storeJson("/api/v1/apps?limit=1"), (err: any) => err.status === 503 && /Settings → Stores/.test(err.message));
		} finally {
			await b.close();
		}
	});
});

// Races and retries: states the code could reach when two requests overlap.
// The mock node holds a call open (celld.gate) so the interleaving is exact,
// not left to timing.
describe("races and retries", () => {
	/** Holds the first admin call for which `match` is true until `release()`. */
	function hold(match: (path: string, query: Record<string, string>) => boolean) {
		let release!: () => void;
		let reached!: () => void;
		const open = new Promise<void>((r) => (release = r));
		const arrived = new Promise<void>((r) => (reached = r));
		let taken = false;
		celld.gate = (path, query) => {
			if (taken || !match(path, query)) return undefined;
			taken = true;
			reached();
			return open;
		};
		return {
			arrived,
			release() {
				celld.gate = null;
				release();
			},
		};
	}
	const publishAs = async (token: string, owner: string, over, bundleVersion: string) => {
		const m = manifest(over);
		const created = await call(storeBase, `/api/v1/apps/${owner}/${m.slug}/releases`, { method: "POST", token, json: { manifest: m } });
		assert.equal(created.status, 201, created.text);
		const bytes = await bundle({ version: bundleVersion, files: { "index.html": `<h1>${bundleVersion}</h1>` } });
		const up = await call(storeBase, created.body.upload.url, { method: "PUT", token, body: bytes, headers: { "content-type": "application/gzip" } });
		assert.equal(up.status, 201, up.text);
	};
	let adaB;
	let bobB;
	before(async () => {
		adaB = await signIn(ADA);
		bobB = await signIn(BOB);
	});

	it("does not let an app be uninstalled while an update of it is in flight", async () => {
		await publish({ slug: "racer", name: "Racer" }, "a10000000001");
		assert.equal((await apiCall(adaB, "POST", "/api/apps", { id: "pub/racer" })).status, 200);
		await publish({ slug: "racer", name: "Racer", version: "1.1.0" }, "a10000000002");
		const stall = hold((path) => path === "/check");
		const update = apiCall(adaB, "POST", "/api/apps", { id: "pub/racer" });
		await stall.arrived;
		const removed = await apiCall(adaB, "DELETE", "/api/apps/racer");
		stall.release();
		const done = await update;
		assert.equal(removed.status, 409, removed.text);
		assert.equal(done.status, 200, done.text);
		assert.equal(done.json.app.version, "1.1.0");
		assert.equal((await adaB.request("GET", "/api/apps/racer", { host: SHELL })).status, 200, "still installed");
	});

	it("refuses a second app of the same name installed at the same time", async () => {
		const other = (await call(storeBase, "/api/v1/publishers", { method: "POST", json: { name: "other", password: "correct horse battery", acceptPolicy: true } })).body.token;
		await publish({ slug: "twin", name: "Twin" }, "b20000000001");
		await publishAs(other, "other", { slug: "twin", name: "Twin Too" }, "b20000000002");
		const stall = hold((path) => path === "/check");
		const first = apiCall(adaB, "POST", "/api/apps", { id: "pub/twin" });
		await stall.arrived;
		const second = await apiCall(adaB, "POST", "/api/apps", { id: "other/twin" });
		stall.release();
		const one = await first;
		assert.equal(one.status, 200, one.text);
		assert.equal(second.status, 409, second.text);
		assert.match(second.json.error, /twin/);
		assert.equal((await adaB.request("GET", "/api/apps/twin", { host: SHELL })).json.app.storeId, "pub/twin");
	});

	it("puts a crumb made during an update on the new code", async () => {
		await publish({ slug: "mover", name: "Mover" }, "c30000000001");
		assert.equal((await apiCall(adaB, "POST", "/api/apps", { id: "pub/mover" })).status, 200);
		await publish({ slug: "mover", name: "Mover", version: "1.1.0" }, "c30000000002");
		const stall = hold((path) => path === "/activate");
		const creating = apiCall(bobB, "POST", "/api/crumbs", { slug: "mover" });
		await stall.arrived;
		const update = await apiCall(adaB, "POST", "/api/apps", { id: "pub/mover" });
		assert.equal(update.status, 200, update.text);
		stall.release();
		const made = await creating;
		assert.equal(made.status, 201, made.text);
		const app = hamstr.core.q.app.get("mover");
		const row = hamstr.core.q.crumb.get(made.json.crumb.id);
		assert.equal(row.code_version, app.code_version, "the crumb follows the app");
		assert.equal(celld.sites.get(crumbHost(row.id)), app.code_version, "and so does its celld site");
	});

	it("leaves no site behind when the app is uninstalled while a crumb is being made", async () => {
		await publish({ slug: "fleeting", name: "Fleeting" }, "f00000000001");
		assert.equal((await apiCall(adaB, "POST", "/api/apps", { id: "pub/fleeting" })).status, 200);
		const before = new Set(celld.sites.keys());
		const stall = hold((path) => path === "/activate");
		const creating = apiCall(bobB, "POST", "/api/crumbs", { slug: "fleeting" });
		await stall.arrived;
		assert.equal((await apiCall(adaB, "DELETE", "/api/apps/fleeting")).status, 200);
		stall.release();
		const made = await creating;
		assert.equal(made.status, 409, made.text);
		assert.deepEqual([...celld.sites.keys()].filter((h) => !before.has(h)), [], "no orphan site on the node");
	});

	it("keeps a single-instance app to one live item per person", async () => {
		await publish({ slug: "solo", name: "Solo", instances: "single" }, "d40000000001");
		assert.equal((await apiCall(adaB, "POST", "/api/apps", { id: "pub/solo" })).status, 200);
		const first = (await apiCall(bobB, "POST", "/api/apps/solo/open", {})).json.crumb;
		// The API does not make a second one beside it.
		assert.equal((await apiCall(bobB, "POST", "/api/crumbs", { slug: "solo" })).status, 409);
		// Trash the first, open a new one, and the old one cannot come back beside it.
		await apiCall(bobB, "POST", `/api/crumbs/${first.id}/trash`, {});
		const second = (await apiCall(bobB, "POST", "/api/apps/solo/open", {})).json.crumb;
		assert.notEqual(second.id, first.id);
		assert.equal((await apiCall(bobB, "POST", `/api/crumbs/${first.id}/restore`, {})).status, 409);
		// With nothing else live it restores as before.
		await apiCall(bobB, "POST", `/api/crumbs/${second.id}/trash`, {});
		assert.equal((await apiCall(bobB, "POST", `/api/crumbs/${first.id}/restore`, {})).status, 200);
		const live = hamstr.core.db.prepare("SELECT COUNT(*) AS n FROM crumbs WHERE slug = 'solo' AND owner_id = ? AND trashed_at IS NULL").get(hamstr.core.q.crumb.get(first.id).owner_id);
		assert.equal(live.n, 1);
	});

	it("does not delete an item while a reset of it is running", async () => {
		await publish({ slug: "wiper", name: "Wiper" }, "e50000000001");
		assert.equal((await apiCall(adaB, "POST", "/api/apps", { id: "pub/wiper" })).status, 200);
		const crumb = (await apiCall(bobB, "POST", "/api/crumbs", { slug: "wiper" })).json.crumb;
		const stall = hold((path) => path === "/dump");
		const reset = apiCall(bobB, "POST", `/api/crumbs/${crumb.id}/reset`, { confirm: crumb.id });
		await stall.arrived;
		await apiCall(bobB, "POST", `/api/crumbs/${crumb.id}/trash`, {});
		const purge = await apiCall(bobB, "DELETE", `/api/crumbs/${crumb.id}`);
		stall.release();
		const done = await reset;
		assert.equal(purge.status, 409, purge.text);
		assert.equal(done.status, 200, done.text);
		assert.ok(hamstr.core.q.crumb.get(crumb.id), "the item is still there");
		assert.ok(celld.sites.has(crumbHost(crumb.id)));
	});

	it("holds the per-person item limit when two items are made at once", async () => {
		await publish({ slug: "capped", name: "Capped" }, "f60000000001");
		assert.equal((await apiCall(adaB, "POST", "/api/apps", { id: "pub/capped" })).status, 200);
		const probe = (await apiCall(bobB, "POST", "/api/crumbs", { slug: "capped" })).json.crumb.id;
		const bobId = hamstr.core.q.crumb.get(probe).owner_id;
		hamstr.core.db.prepare("DELETE FROM crumbs WHERE id = ?").run(probe);
		const have = Number(hamstr.core.db.prepare("SELECT COUNT(*) AS n FROM crumbs WHERE owner_id = ?").get(bobId).n);
		const filler = [];
		// Fill his account to one below the limit with trashed items (they count, and stay out of the way).
		for (let i = have; i < hamstr.core.MAX_CRUMBS_PER_USER - 1; i++) {
			const id = `filler${String(i).padStart(6, "0")}`;
			filler.push(id);
			hamstr.core.db.prepare("INSERT INTO crumbs (id, slug, title, owner_id, code_version, created_at, trashed_at) VALUES (?, 'capped', 'filler', ?, 'x', ?, ?)").run(id, bobId, hamstr.core.now(), hamstr.core.now());
		}
		try {
			const before = new Set(celld.sites.keys());
			const [a, b] = await Promise.all([apiCall(bobB, "POST", "/api/crumbs", { slug: "capped" }), apiCall(bobB, "POST", "/api/crumbs", { slug: "capped" })]);
			assert.deepEqual([a.status, b.status].sort(), [201, 403], `${a.text} ${b.text}`);
			const total = Number(hamstr.core.db.prepare("SELECT COUNT(*) AS n FROM crumbs WHERE owner_id = ?").get(bobId).n);
			assert.equal(total, hamstr.core.MAX_CRUMBS_PER_USER);
			assert.equal([...celld.sites.keys()].filter((h) => !before.has(h)).length, 1, "the refused one left no site");
			const made = [a, b].find((r) => r.status === 201).json.crumb.id;
			hamstr.core.db.prepare("DELETE FROM crumbs WHERE id = ?").run(made);
		} finally {
			for (const id of filler) hamstr.core.db.prepare("DELETE FROM crumbs WHERE id = ?").run(id);
		}
	});
});
