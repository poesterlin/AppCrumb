// Regression tests for the release lifecycle (docs/STATE-MACHINES.md): states
// that concurrency or retries used to reach and the table says are not allowed.
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import { migrate, openDb } from "../db.ts";
import { createModeration } from "../moderation/server.ts";
import { publishRelease, rejectRelease, removeRelease, writeSetting, yankRelease } from "../releases.ts";
import { createStore } from "../server.ts";
import { bundle, call, manifest, sha256 } from "./helpers.ts";

const dir = mkdtempSync(join(tmpdir(), "store-lifecycle-test-"));
const databaseUrl = process.env.STORE_TEST_DATABASE_URL;

describe("release lifecycle under concurrency", () => {
	let db;
	let store;
	let moderation;
	let base: string;
	let jev;
	/** Runs inside the classifier call: the moment a person can act mid-check. */
	let duringCheck: (() => Promise<void>) | null = null;

	before(async () => {
		jev = createServer(async (req, res) => {
			for await (const _ of req);
			await duringCheck?.();
			res.writeHead(200, { "content-type": "application/json" }).end(
				JSON.stringify({
					model: "jev-test",
					answers: {
						harm: { score: duringBlock ? 4 : 0.8, confidence: 0.9 },
						kind: { choice: "utility", confidence: 0.9, probabilities: {} },
						impersonation: { noul: 0.1 },
						collects_secrets: { noul: 0.1 },
					},
				}),
			);
		});
		await new Promise<void>((r) => jev.listen(0, "127.0.0.1", () => r()));
		db = await openDb({ url: databaseUrl, dir: databaseUrl ? undefined : join(dir, "pg") });
		await migrate(db);
		store = createStore({ dataDir: dir, db, requireReview: true, rateLimit: false, logging: false });
		base = `http://127.0.0.1:${(await store.listen(0, "127.0.0.1")).port}`;
		moderation = createModeration({
			db,
			dataDir: dir,
			password: "moderator password",
			worker: false,
			logging: false,
			classifier: { url: `http://127.0.0.1:${(jev.address() as AddressInfo).port}/v1/systemone`, model: "jev-test" },
			policy: { autoApprove: true },
		});
		await moderation.listen(0, "127.0.0.1");
	});
	after(async () => {
		await moderation.close();
		await store.close();
		await db.close();
		jev.close();
		rmSync(dir, { recursive: true, force: true });
	});

	let duringBlock = false;
	async function publisher(name: string): Promise<string> {
		const res = await call(base, "/api/v1/publishers", { method: "POST", json: { name, password: "correct horse battery", acceptPolicy: true } });
		assert.equal(res.status, 201, res.text);
		return res.body.token;
	}
	/** Creates a release and uploads its bundle: it ends up `pending` (review mode). */
	async function submit(token: string, owner: string, slug: string, version: string): Promise<number> {
		const created = await call(base, `/api/v1/apps/${owner}/${slug}/releases`, { method: "POST", token, json: { manifest: manifest({ slug, name: slug, version }) } });
		assert.equal(created.status, 201, created.text);
		const bytes = await bundle({ files: { "index.html": `<h1>${slug} ${version}</h1>` } });
		const up = await call(base, created.body.upload.url, { method: "PUT", token, body: bytes, headers: { "x-content-sha256": sha256(bytes) } });
		assert.equal(up.status, 201, up.text);
		return created.body.release.id;
	}
	const statusOf = async (id: number) => (await db.one("SELECT status FROM releases WHERE id = $1", [id])).status;

	it("does not publish a release a moderator rejected while its checks were running", async () => {
		const token = await publisher("racer");
		const id = await submit(token, "racer", "notes", "1.0.0");
		duringBlock = false;
		duringCheck = async () => {
			// The moderator decides while the (slow) classifier is still thinking.
			assert.ok(await db.tx((sql) => rejectRelease(sql, id, { by: "ada", note: "not for this store" })));
		};
		try {
			await moderation.checker.tick();
		} finally {
			duringCheck = null;
		}
		assert.equal(await statusOf(id), "rejected", "the person's decision stands");
		const check = await db.one("SELECT status, action FROM moderation_checks WHERE release_id = $1", [id]);
		assert.equal(check.status, "done");
		assert.equal(check.action, null, "the checks must not claim an action they did not take");
	});

	it("does not take down a release a moderator approved while its checks were running", async () => {
		const token = await publisher("approved");
		const id = await submit(token, "approved", "tool", "1.0.0");
		duringBlock = true;
		duringCheck = async () => {
			await db.run("UPDATE releases SET status = 'published', published_at = now(), reviewed_at = now(), reviewed_by = 'ada' WHERE id = $1", [id]);
		};
		try {
			await moderation.checker.tick();
		} finally {
			duringCheck = null;
			duringBlock = false;
		}
		assert.equal(await statusOf(id), "published", "the person's decision stands");
		assert.equal((await db.one("SELECT action FROM moderation_checks WHERE release_id = $1", [id])).action, null);
	});

	it("still auto-publishes and auto-blocks when nobody interfered", async () => {
		const token = await publisher("calm");
		const ok = await submit(token, "calm", "plain", "1.0.0");
		await moderation.checker.tick();
		assert.equal(await statusOf(ok), "published");
		duringBlock = true;
		const bad = await submit(token, "calm", "plain", "1.1.0");
		try {
			await moderation.checker.tick();
		} finally {
			duringBlock = false;
		}
		assert.equal(await statusOf(bad), "rejected");
	});

	it("yank and delete never override a moderator's rejection", async () => {
		const token = await publisher("yanker");
		const id = await submit(token, "yanker", "thing", "1.0.0");
		assert.ok(await db.tx((sql) => rejectRelease(sql, id, { by: "ada", note: "no" })));
		// The owner's request read the release as pending a moment earlier.
		assert.equal(await yankRelease(db, id), false);
		assert.equal(await statusOf(id), "rejected");
		const row = await db.one("SELECT * FROM releases WHERE id = $1", [id]);
		assert.equal(await removeRelease(db, row), false);
		assert.equal(await statusOf(id), "rejected", "a rejected release stays as the moderators left it");
		// Over HTTP the same answers.
		assert.equal((await call(base, `/api/v1/releases/${id}/yank`, { method: "POST", token })).status, 409);
		assert.equal((await call(base, `/api/v1/releases/${id}`, { method: "DELETE", token })).status, 409);
	});

	it("yank is only for published and pending releases", async () => {
		const token = await publisher("yanker2");
		const id = await submit(token, "yanker2", "thing", "1.0.0");
		assert.equal(await yankRelease(db, id), true);
		assert.equal(await statusOf(id), "yanked");
		assert.equal(await yankRelease(db, id), false, "yanking twice is refused, not repeated");
	});

	it("frees the slots of abandoned uploads while the store keeps running", async () => {
		const token = await publisher("flaky");
		const created = await call(base, "/api/v1/apps/flaky/ghost/releases", { method: "POST", token, json: { manifest: manifest({ slug: "ghost", name: "ghost", version: "1.0.0" }) } });
		assert.equal(created.status, 201);
		const id = created.body.release.id;
		await db.run("UPDATE releases SET created_at = now() - interval '25 hours' WHERE id = $1", [id]);
		await store.sweep();
		assert.equal(await db.one("SELECT 1 FROM releases WHERE id = $1", [id]), undefined);
		// A fresh upload in progress is left alone.
		const fresh = await call(base, "/api/v1/apps/flaky/ghost/releases", { method: "POST", token, json: { manifest: manifest({ slug: "ghost", name: "ghost", version: "1.0.1" }) } });
		await store.sweep();
		assert.ok(await db.one("SELECT 1 FROM releases WHERE id = $1", [fresh.body.release.id]));
	});

	it("lets a publish be retried after its upload never happened, but not once it has a bundle", async () => {
		const token = await publisher("retrier");
		const create = (summary: string) =>
			call(base, "/api/v1/apps/retrier/again/releases", { method: "POST", token, json: { manifest: manifest({ slug: "again", name: "again", version: "1.0.0", summary }) } });
		const first = await create("A first try.");
		assert.equal(first.status, 201, first.text);
		// The connection dropped before the bundle went up; the CLI runs it again.
		const second = await create("A second try.");
		assert.equal(second.status, 201, second.text);
		assert.equal(second.body.release.id, first.body.release.id, "the same release, not a second one");
		assert.equal((await db.one("SELECT manifest FROM releases WHERE id = $1", [first.body.release.id])).manifest.summary, "A second try.");
		assert.equal((await db.query("SELECT 1 FROM releases r JOIN apps a ON a.id = r.app_id WHERE a.ref = 'retrier/again'")).length, 1);
		const bytes = await bundle({ files: { "index.html": "<h1>again</h1>" } });
		const up = await call(base, second.body.upload.url, { method: "PUT", token, body: bytes, headers: { "x-content-sha256": sha256(bytes) } });
		assert.equal(up.status, 201, up.text);
		// With a bundle the version is taken for good.
		assert.equal((await create("A third try.")).status, 409);
		// And nobody else's release can be taken over this way.
		const other = await publisher("bystander");
		const hijack = await call(base, "/api/v1/apps/retrier/again/releases", { method: "POST", token: other, json: { manifest: manifest({ slug: "again", name: "again", version: "1.0.0" }) } });
		assert.equal(hijack.status, 403);
	});

	it("keeps the file of a rejected release that shares its bytes with a release the owner deletes", async () => {
		const token = await publisher("twins");
		// Two versions with the same code are the same bundle, stored once.
		const upload = async (version: string) => {
			const created = await call(base, "/api/v1/apps/twins/same/releases", { method: "POST", token, json: { manifest: manifest({ slug: "same", name: "same", version }) } });
			const bytes = await bundle({ files: { "index.html": "<h1>same</h1>" } });
			const up = await call(base, created.body.upload.url, { method: "PUT", token, body: bytes, headers: { "x-content-sha256": sha256(bytes) } });
			assert.equal(up.status, 201, up.text);
			return { id: created.body.release.id as number, sha: up.body.release.bundleSha256 as string };
		};
		const one = await upload("1.0.0");
		const two = await upload("1.0.1");
		assert.equal(one.sha, two.sha);
		assert.ok(await db.tx((sql) => rejectRelease(sql, one.id, { by: "ada", note: "no" })));
		assert.equal((await call(base, `/api/v1/releases/${two.id}`, { method: "DELETE", token })).status, 200);
		assert.ok(existsSync(join(dir, "blobs", `${one.sha}.tgz`)), "the moderators may still reverse the rejection");
	});

	it("never leaves a release pointing at a deleted file when a delete and an identical upload overlap", async () => {
		const token = await publisher("overlap");
		for (let round = 0; round < 15; round++) {
			const html = `<h1>round ${round}</h1>`;
			const bytes = await bundle({ files: { "index.html": html } });
			const make = async (version: string) => {
				const created = await call(base, "/api/v1/apps/overlap/pair/releases", { method: "POST", token, json: { manifest: manifest({ slug: "pair", name: "pair", version }) } });
				assert.equal(created.status, 201, created.text);
				return created.body;
			};
			const a = await make(`1.${round}.0`);
			const b = await make(`1.${round}.1`);
			const put = (c) => call(base, c.upload.url, { method: "PUT", token, body: bytes, headers: { "x-content-sha256": sha256(bytes) } });
			assert.equal((await put(a)).status, 201);
			// Delete A while B uploads the same bytes.
			const [, uploaded] = await Promise.all([call(base, `/api/v1/releases/${a.release.id}`, { method: "DELETE", token }), put(b)]);
			assert.equal(uploaded.status, 201, uploaded.text);
			const row = await db.one("SELECT bundle_sha FROM releases WHERE id = $1", [b.release.id]);
			assert.ok(existsSync(join(dir, "blobs", `${row.bundle_sha}.tgz`)), `round ${round}: B's file is there`);
		}
	});

	it("ignores a check that was superseded by a recheck", async () => {
		const token = await publisher("rechecked");
		// Earlier tests left releases unchecked; the hook must fire for this one.
		while ((await moderation.checker.tick()) > 0);
		const id = await submit(token, "rechecked", "again", "1.0.0");
		duringCheck = async () => {
			// A moderator pressed "run the checks again": the old claim is replaced by a newer one.
			await db.run("DELETE FROM moderation_checks WHERE release_id = $1", [id]);
			await db.run("INSERT INTO moderation_checks (release_id, status, started_at) VALUES ($1, 'running', now() + interval '1 second')", [id]);
		};
		try {
			await moderation.checker.tick();
		} finally {
			duringCheck = null;
		}
		const check = await db.one("SELECT status, verdict, action FROM moderation_checks WHERE release_id = $1", [id]);
		assert.equal(check.status, "running", "the old run does not write over the newer claim");
		assert.equal(check.verdict, null);
		assert.equal(await statusOf(id), "pending", "and it did not publish on its own authority");
	});

	it("does not let a moderator's reversal bring back a release its owner withdrew", async () => {
		const token = await publisher("withdrawer");
		const id = await submit(token, "withdrawer", "gone", "1.0.0");
		assert.equal((await call(base, `/api/v1/releases/${id}/yank`, { method: "POST", token })).status, 200);
		assert.ok(await db.tx((sql) => rejectRelease(sql, id, { by: "ada", note: "also bad" })));
		assert.equal(await db.tx((sql) => publishRelease(sql, id, { by: "ada" })), false, "withdrawn by the owner stays withdrawn");
		assert.equal(await statusOf(id), "rejected");
		// A plain rejection can still be reversed.
		const other = await submit(token, "withdrawer", "kept", "1.0.0");
		assert.ok(await db.tx((sql) => rejectRelease(sql, other, { by: "ada", note: "hmm" })));
		assert.equal(await db.tx((sql) => publishRelease(sql, other, { by: "ada" })), true);
	});

	it("does not let a paused store complete uploads that were started before the pause", async () => {
		const token = await publisher("early");
		const created = await call(base, "/api/v1/apps/early/prepared/releases", { method: "POST", token, json: { manifest: manifest({ slug: "prepared", name: "prepared", version: "1.0.0" }) } });
		assert.equal(created.status, 201);
		await writeSetting(db, "publishing", false, "mod");
		// The store caches the switches for a few seconds.
		await new Promise((r) => setTimeout(r, 5100));
		try {
			const bytes = await bundle({ files: { "index.html": "<h1>prepared</h1>" } });
			const up = await call(base, created.body.upload.url, { method: "PUT", token, body: bytes, headers: { "x-content-sha256": sha256(bytes) } });
			assert.equal(up.status, 503, up.text);
			assert.equal(await statusOf(created.body.release.id), "uploading");
		} finally {
			await writeSetting(db, "publishing", true, "mod");
		}
	});
});
