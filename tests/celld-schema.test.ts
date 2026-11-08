// tools/celld.schema.json: every celld.json in the repo satisfies it, it rejects
// what pack.ts would, and pack.ts enforces it.
// Run: node --test tests/celld-schema.test.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { validate } from "../tools/schema.ts";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const schema = JSON.parse(readFileSync(join(root, "tools/celld.schema.json"), "utf8"));
const problems = (config: unknown) => validate(schema, config);

describe("celld.schema.json", () => {
	it("accepts every celld.json in the repository", () => {
		const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "*celld.json"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);
		assert.ok(files.length >= 10, `found only ${files.length} celld.json files`);
		for (const file of files) assert.deepEqual(problems(JSON.parse(readFileSync(join(root, file), "utf8"))), [], file);
	});

	it("accepts every field with a valid value", () => {
		assert.deepEqual(
			problems({ $schema: "../tools/celld.schema.json", worker: null, assets: "dist", objects: "o.ts", exclude: ["a"], immutable: [], mutable: ["x"], compatibilityDate: "2026-02-24", auth: "required", check: false, notFound: "spa", minify: true }),
			[],
		);
		assert.deepEqual(problems({ check: "/health" }), []);
	});

	it("rejects unknown fields, so a typo is an error", () => {
		const [message] = problems({ worker: "w.js", frming: "self" });
		assert.match(message, /\$\.frming is not a known field/);
	});

	it("rejects wrong types and values", () => {
		for (const bad of [
			{ worker: 3 },
			{ assets: "" },
			{ exclude: "a" },
			{ immutable: [1] },
			{ compatibilityDate: "soon" },
			{ auth: "maybe" },
			{ check: true },
			{ check: "health" },
			{ notFound: "404" },
			{ minify: "yes" },
		]) assert.notDeepEqual(problems(bad), [], JSON.stringify(bad));
	});

	it("is enforced by pack.ts", () => {
		const dir = mkdtempSync(join(tmpdir(), "schema-"));
		writeFileSync(join(dir, "worker.js"), "export default { fetch() { return new Response('x'); } };\n");
		writeFileSync(join(dir, "celld.json"), JSON.stringify({ worker: "worker.js", check: false, frming: "self" }));
		assert.throws(
			() => execFileSync("node", [join(root, "tools/pack.ts"), dir, join(dir, "out")], { stdio: ["ignore", "ignore", "pipe"] }),
			(err: any) => /celld\.json is invalid/.test(String(err.stderr)) && /frming is not a known field/.test(String(err.stderr)),
		);
	});
});
