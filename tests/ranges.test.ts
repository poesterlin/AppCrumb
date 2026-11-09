// Run: node --test tests/ranges.test.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import { byteRange } from "../router/serve/ranges.ts";

const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });

test("byte ranges", () => {
	assert.equal(byteRange(req({}), '"e"', 100), null);
	assert.deepEqual(byteRange(req({ range: "bytes=0-1" }), '"e"', 100), [0, 1]);
	assert.deepEqual(byteRange(req({ range: "bytes=10-" }), '"e"', 100), [10, 99]);
	assert.deepEqual(byteRange(req({ range: "bytes=-20" }), '"e"', 100), [80, 99]);
	assert.deepEqual(byteRange(req({ range: "bytes=50-500" }), '"e"', 100), [50, 99]);
	assert.equal(byteRange(req({ range: "bytes=100-" }), '"e"', 100), "unsatisfiable");
	assert.equal(byteRange(req({ range: "bytes=0-1,5-6" }), '"e"', 100), null);
	assert.equal(byteRange(req({ range: "bytes=0-1", "if-range": '"old"' }), '"e"', 100), null);
	assert.deepEqual(byteRange(req({ range: "bytes=0-1", "if-range": '"e"' }), '"e"', 100), [0, 1]);
});
