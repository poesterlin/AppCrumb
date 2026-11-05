// Schema refusal: a build that finds migrations it does not know must not start
// on the data a newer build wrote.
// Run: npm test --prefix store
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrate, openDb } from "../db.ts";

test("refuses a database written by a newer build", async () => {
	const dir = mkdtempSync(join(tmpdir(), "store-schema-"));
	const db = await openDb({ dir: join(dir, "pg") });
	try {
		await migrate(db);
		await db.run("INSERT INTO schema_migrations (version, applied_at) VALUES ($1, now())", [9999]);
		await assert.rejects(() => migrate(db), /refusing to start on newer data/);
	} finally {
		await db.close();
	}
});
