// Home mode (HAMSTR_AUTH=none): no sign-in, a port per crumb.
// Run: npm test --prefix hamstr
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { connect } from "node:net";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { createStore } from "../../store/server.ts";
import { bundle, call, manifest } from "../../store/test/helpers.ts";
import { createHamstr } from "../server.ts";
import { Browser, mockCelld } from "./helpers.ts";

// What the browser typed: the box's name and the add-on's port.
const SHELL = "homeassistant.local:8000";
const FIRST_PORT = 21500;
const dir = mkdtempSync(join(tmpdir(), "hamstr-home-"));
let celld;
let store;
let hamstr;
let shell;

const api = (method: string, path: string, json?: unknown, host = SHELL) =>
	shell.request(method, path, { host, headers: { "sec-fetch-site": "same-origin", origin: `http://${host}` }, ...(json !== undefined && { json }) });
/** A request to a crumb's port, as the browser sends it. */
const onCrumb = (port: number, method: string, path: string, headers = {}, body?: string) =>
	new Browser(port).request(method, path, { host: `homeassistant.local:${port}`, headers, body });
const crumbPortOf = (url: string) => Number(new URL(url).port);
/** Whether anything accepts a new connection on the port. */
const listening = (port: number) =>
	new Promise((resolve) => {
		const socket = connect(port, "127.0.0.1", () => resolve(socket.end() && true));
		socket.on("error", () => resolve(false));
	});

before(async () => {
	celld = await mockCelld();
	store = createStore({ dataDir: join(dir, "store"), rateLimit: false, logging: false });
	const storeBase = `http://127.0.0.1:${(await store.listen(0, "127.0.0.1")).port}`;
	const token = (await call(storeBase, "/api/v1/publishers", { method: "POST", json: { name: "pub", password: "correct horse battery", acceptPolicy: true } })).body.token;
	const m = manifest({ slug: "board", name: "Board", icon: "📌" });
	const created = await call(storeBase, "/api/v1/apps/pub/board/releases", { method: "POST", token, json: { manifest: m } });
	await call(storeBase, created.body.upload.url, { method: "PUT", token, body: await bundle({ version: "aaaaaaaaaaaa", files: { "index.html": "<h1>board</h1>" } }), headers: { "content-type": "application/gzip" } });
	hamstr = createHamstr({
		dataDir: join(dir, "hamstr"),
		crumbDomain: "crumbs.internal",
		scheme: "http",
		publicPort: 8000,
		store: storeBase,
		celldApi: celld.api,
		adminToken: celld.adminToken,
		proxyToken: celld.proxyToken,
		secret: "test-secret",
		auth: "none",
		crumbPorts: `${FIRST_PORT}-${FIRST_PORT + 2}`,
		crumbListenHost: "127.0.0.1",
		logging: false,
	});
	shell = new Browser((await hamstr.listen(0, "127.0.0.1")).port);
});

after(async () => {
	await hamstr.close();
	await store.close();
	await celld.close();
	rmSync(dir, { recursive: true, force: true });
});

describe("home mode", () => {
	let board;
	let notes;

	it("treats every visitor as the owner, on any hostname", async () => {
		const me = (await shell.request("GET", "/api/me", { host: SHELL })).json;
		assert.equal(me.user.admin, true);
		assert.equal(me.user.name, "Owner");
		assert.equal((await shell.request("GET", "/api/me", { host: "192.168.1.5:8000" })).json.user.id, me.user.id);
		assert.equal(hamstr.core.accounts.people().length, 1, "one owner, made once");
	});

	it("allows the Home Assistant sidebar to frame the shell", async () => {
		const page = await shell.request("GET", "/", { host: SHELL });
		assert.match(page.headers["content-security-policy"], /frame-ancestors \*/);
		assert.equal(page.headers["x-frame-options"], undefined);
	});

	it("installs an app and opens each crumb on a port of its own", async () => {
		assert.equal((await api("POST", "/api/apps", { id: "pub/board" })).status, 200);
		board = (await api("POST", "/api/crumbs", { slug: "board", title: "Kitchen" })).json.crumb;
		notes = (await api("POST", "/api/crumbs", { slug: "board", title: "Notes" })).json.crumb;
		const opened = await api("POST", `/api/crumbs/${board.id}/open`, { path: "/list?x=1" });
		assert.equal(opened.json.url, `http://homeassistant.local:${FIRST_PORT}/list?x=1`, "the host the browser used, no ticket");
		// The same port every time; the next crumb gets the next one.
		assert.equal((await api("POST", `/api/crumbs/${board.id}/open`, { path: "/" })).json.url, `http://homeassistant.local:${FIRST_PORT}/`);
		assert.equal((await shell.request("GET", `/api/crumbs/${board.id}`, { host: SHELL })).json.crumb.origin, null, "no fixed origin to report");
		const other = (await api("POST", `/api/crumbs/${notes.id}/open`, { path: "/" }, "192.168.1.5:8000")).json.url;
		assert.equal(other, `http://192.168.1.5:${FIRST_PORT + 1}/`);
	});

	it("proxies a crumb port to its crumb, as the owner, framed by the shell only", async () => {
		const r = await onCrumb(FIRST_PORT, "GET", "/list?x=1", { "x-hamstr-role": "forged" });
		assert.equal(r.status, 200, r.text);
		const h = r.json.headers;
		assert.equal(r.json.host, `crumb-${board.id}.crumbs.internal`);
		assert.equal(h["x-hamstr-role"], "owner");
		assert.equal(decodeURIComponent(h["x-hamstr-username"]), "Owner");
		assert.match(h["x-hamstr-session-id"], /^[a-f0-9]{16}$/);
		assert.match(r.headers["content-security-policy"], /connect-src 'self'; .*frame-ancestors http:\/\/homeassistant\.local:8000$/);
		assert.equal((await onCrumb(FIRST_PORT + 1, "GET", "/")).json.host, `crumb-${notes.id}.crumbs.internal`);
	});

	it("keeps crumbs from writing to each other or to the shell", async () => {
		const form = { "content-type": "application/x-www-form-urlencoded" };
		assert.equal((await onCrumb(FIRST_PORT + 1, "POST", "/pin", { ...form, "sec-fetch-site": "same-site" }, "a=1")).status, 403);
		assert.equal((await onCrumb(FIRST_PORT + 1, "POST", "/pin", { ...form, origin: `http://homeassistant.local:${FIRST_PORT}` }, "a=1")).status, 403);
		assert.equal((await onCrumb(FIRST_PORT + 1, "POST", "/pin", { ...form, origin: `http://homeassistant.local:${FIRST_PORT + 1}` }, "a=1")).status, 200);
		const fromCrumb = await shell.request("POST", "/api/crumbs", { host: SHELL, headers: { origin: `http://homeassistant.local:${FIRST_PORT}` }, json: { slug: "board" } });
		assert.equal(fromCrumb.status, 403);
	});

	it("closes a deleted crumb's port and gives the port to the next crumb", async () => {
		await api("POST", `/api/crumbs/${notes.id}/trash`, {});
		const deleted = await api("DELETE", `/api/crumbs/${notes.id}`);
		assert.equal(deleted.status, 200, deleted.text);
		assert.equal(await listening(FIRST_PORT + 1), false, "the port is closed");
		const next = (await api("POST", "/api/crumbs", { slug: "board", title: "Garage" })).json.crumb;
		assert.equal(crumbPortOf((await api("POST", `/api/crumbs/${next.id}/open`, { path: "/" })).json.url), FIRST_PORT + 1);
		assert.equal((await onCrumb(FIRST_PORT + 1, "GET", "/")).json.host, `crumb-${next.id}.crumbs.internal`);
	});

	it("says so when every crumb port is taken", async () => {
		const third = (await api("POST", "/api/crumbs", { slug: "board", title: "Third" })).json.crumb;
		assert.equal(crumbPortOf((await api("POST", `/api/crumbs/${third.id}/open`, { path: "/" })).json.url), FIRST_PORT + 2);
		const fourth = (await api("POST", "/api/crumbs", { slug: "board", title: "Fourth" })).json.crumb;
		const r = await api("POST", `/api/crumbs/${fourth.id}/open`, { path: "/" });
		assert.equal(r.status, 503);
		assert.match(r.json.error, /crumb ports/);
	});

	it("redeploys crumb sites under the current host when they are missing", async () => {
		const host = `crumb-${board.id}.crumbs.internal`;
		assert.equal(celld.sites.has(host), true);
		celld.sites.delete(host);
		assert.equal((await onCrumb(FIRST_PORT, "GET", "/")).status, 404, "proxy 404s when celld has no site");
		await hamstr.core.ensureCrumbSites();
		assert.equal(celld.sites.has(host), true);
		assert.equal((await onCrumb(FIRST_PORT, "GET", "/")).status, 200, "ensureCrumbSites puts the site back");
	});
});
