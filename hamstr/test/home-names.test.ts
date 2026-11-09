// Home mode with names (HAMSTR_HOME_NAMES): a hostname per crumb on the shell's port.
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
const FIRST_PORT = 21600;
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
		homeNames: "sslip.io",
		tailnetDomain: "siren-macaroni.ts.net",
		tailnetShell: "hamstr.siren-macaroni.ts.net",
		homeAddress: "192.168.1.5",
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

describe("home mode with names", () => {
	let board;

	it("opens a crumb on a name under sslip.io, on the shell's own port", async () => {
		assert.equal((await api("POST", "/api/apps", { id: "pub/board" })).status, 200);
		board = (await api("POST", "/api/crumbs", { slug: "board", title: "Kitchen" })).json.crumb;
		const byIp = (await api("POST", `/api/crumbs/${board.id}/open`, { path: "/list?x=1" }, "10.0.0.7:8000")).json.url;
		assert.equal(byIp, `http://crumb-${board.id}.10-0-0-7.sslip.io:8000/list?x=1`);
		const byName = (await api("POST", `/api/crumbs/${board.id}/open`, { path: "/" })).json.url;
		assert.equal(byName, `http://crumb-${board.id}.192-168-1-5.sslip.io:8000/`, "a name, not an address: HAMSTR_HOME_ADDRESS");
		assert.equal(hamstr.core.crumbPorts().length, 0, "no port was given out");
	});

	it("proxies that name to the crumb as the owner, on its own origin", async () => {
		const host = `crumb-${board.id}.10-0-0-7.sslip.io:8000`;
		const r = await shell.request("GET", "/list", { host, headers: { "x-hamstr-role": "forged" } });
		assert.equal(r.status, 200, r.text);
		assert.equal(r.json.host, `crumb-${board.id}.crumbs.internal`);
		assert.equal(r.json.headers["x-hamstr-role"], "owner");
		const form = { "content-type": "application/x-www-form-urlencoded" };
		const post = (origin: string) => shell.request("POST", "/pin", { host, headers: { ...form, origin }, body: "a=1" });
		assert.equal((await post(`http://${host}`)).status, 200);
		assert.equal((await post("http://10.0.0.7:8000")).status, 403, "not from the shell");
		assert.equal((await post(`http://crumb-${"a".repeat(12)}.10-0-0-7.sslip.io:8000`)).status, 403, "not from another crumb");
	});

	it("does not answer for other names or other services", async () => {
		const notCrumb = await shell.request("GET", "/api/me", { host: "crumb-abc.10-0-0-7.sslip.io:8000" });
		assert.equal(notCrumb.json.user.name, "Owner", "a malformed crumb name is just the shell");
		const wrongDomain = await shell.request("GET", "/api/me", { host: `crumb-${board.id}.10-0-0-7.nip.io:8000` });
		assert.equal(wrongDomain.json?.user?.name, "Owner", "only the configured service is a crumb");
		const badIp = await shell.request("GET", "/api/me", { host: `crumb-${board.id}.999-0-0-7.sslip.io:8000` });
		assert.equal(badIp.json?.user?.name, "Owner");
	});

	it("lets an admin switch it in Settings and keeps the choice", async () => {
		assert.equal((await api("PUT", "/api/admin/home-network", { names: "nip.io", address: "10.1.2.3" })).status, 200);
		const url = (await api("POST", `/api/crumbs/${board.id}/open`, { path: "/" })).json.url;
		assert.equal(url, `http://crumb-${board.id}.10-1-2-3.nip.io:8000/`, "the saved address is used when the browser used a name");
		assert.equal((await api("PUT", "/api/admin/home-network", { names: "example.com" })).status, 400);
		assert.equal((await api("PUT", "/api/admin/home-network", { names: "sslip.io", address: "999.1.1.1" })).status, 400);
		assert.equal((await api("PUT", "/api/admin/home-network", { names: "off" })).status, 200);
		const ports = (await api("POST", `/api/crumbs/${board.id}/open`, { path: "/" })).json.url;
		assert.equal(ports, `http://homeassistant.local:${FIRST_PORT}/`);
		assert.equal((await api("GET", "/api/admin/home-network")).json.names, "off");
		const page = await shell.request("GET", "/settings/addresses", { host: SHELL });
		assert.equal(page.status, 200, page.text.slice(0, 300));
	});

	it("answers on a Tailscale Services name when HAMSTR_TAILNET_DOMAIN is set, with an https origin", async () => {
		const host = `crumb-${board.id}.siren-macaroni.ts.net`;
		const r = await shell.request("GET", "/list", { host });
		assert.equal(r.status, 200, r.text);
		assert.equal(r.json.host, `crumb-${board.id}.crumbs.internal`);
		const form = { "content-type": "application/x-www-form-urlencoded" };
		const post = (origin: string) => shell.request("POST", "/pin", { host, headers: { ...form, origin }, body: "a=1" });
		assert.equal((await post(`https://${host}`)).status, 200);
		assert.equal((await post(`http://${host}`)).status, 403, "only the https origin is its own");
		assert.equal((await post("https://homelab.siren-macaroni.ts.net")).status, 403);
		const other = await shell.request("GET", "/api/me", { host: `crumb-${board.id}.other.ts.net` });
		assert.equal(other.json?.user?.name, "Owner", "another tailnet's name is just the shell");
	});

	it("opens a crumb on its Tailscale Services name when the shell was reached over the tailnet", async () => {
		const open = async (host: string) => (await api("POST", `/api/crumbs/${board.id}/open`, { path: "/list?x=1" }, host)).json.url;
		const tailnetUrl = `https://crumb-${board.id}.siren-macaroni.ts.net/list?x=1`;
		assert.equal(await open("hamstr.siren-macaroni.ts.net:8000"), tailnetUrl, "a MagicDNS name");
		assert.equal(await open("100.97.234.108:8000"), tailnetUrl, "a Tailscale address");
		// Anything else keeps the LAN address (a port or a name, per Settings → Addresses).
		assert.match(await open("100.128.0.1:8000"), /^http:\/\/(?!crumb-.*\.ts\.net)/, "outside 100.64.0.0/10");
		assert.match(await open("hamstr.other.ts.net:8000"), /^http:\/\//, "another tailnet");
		assert.match(await open(SHELL), /^http:\/\//, "the LAN name");
		const shellPage = await shell.request("GET", `/c/${board.id}/open`, { host: "hamstr.siren-macaroni.ts.net:8000" });
		assert.equal(shellPage.headers.location, `https://crumb-${board.id}.siren-macaroni.ts.net/`);
	});

	it("links back to the shell by its address, not by the crumb's name", () => {
		const c = hamstr.core;
		assert.equal(c.homeShellHost(`crumb-${board.id}.10-0-0-7.sslip.io:8000`), "10.0.0.7");
		assert.equal(c.homeShellHost(`crumb-${board.id}.10-0-0-7.nip.io`), "10.0.0.7");
		assert.equal(c.homeShellHost("homeassistant.local:8000"), "homeassistant.local");
		assert.equal(c.homeShellHost(`crumb-${board.id}.siren-macaroni.ts.net`), "hamstr.siren-macaroni.ts.net", "a tailnet crumb: the shell's tailnet name");
	});

	it("takes the shell's own https origin behind tailscale serve, and no other", async () => {
		const post = (host: string, origin: string) =>
			shell.request("PUT", "/api/admin/home-network", { host, headers: { origin, "content-type": "application/json" }, body: JSON.stringify({ names: "off", address: "" }) });
		assert.equal((await post("hamstr.siren-macaroni.ts.net", "https://hamstr.siren-macaroni.ts.net")).status, 200);
		assert.equal((await post("hamstr.siren-macaroni.ts.net", "https://evil.example")).status, 403);
		assert.equal((await post("homeassistant.local:8000", "https://homeassistant.local:8000")).status, 403, "https only on the tailnet");
	});

	it("takes only plain unicast addresses", async () => {
		for (const bad of ["010.0.0.7", "0.0.0.0", "255.255.255.255", "1.2.3", "1.2.3.4.5", "256.1.1.1", "1.2.3.04"]) {
			assert.equal((await api("PUT", "/api/admin/home-network", { names: "sslip.io", address: bad })).status, 400, bad);
		}
		const leading = await shell.request("GET", "/api/me", { host: `crumb-${board.id}.010-0-0-7.sslip.io:8000` });
		assert.equal(leading.json?.user?.name, "Owner", "a leading-zero name is not a crumb");
	});

	it("will not change the address for a page reached through a name someone else controls", async () => {
		const rebound = await api("PUT", "/api/admin/home-network", { names: "sslip.io", address: "6.6.6.6" }, "evil.example.com:8000");
		assert.equal(rebound.status, 403, rebound.text);
		assert.notEqual((await api("GET", "/api/admin/home-network")).json.address, "6.6.6.6");
		assert.equal((await api("PUT", "/api/admin/home-network", { names: "off" }, "10.0.0.7:8000")).status, 200, "an address is fine");
	});
});
