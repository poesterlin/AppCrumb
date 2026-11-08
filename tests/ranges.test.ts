import { expect, mock, test } from "bun:test";
mock.module("cloudflare:workers", () => ({ WorkerEntrypoint: class {} }));
const { byteRange } = await import("../router/serve/assets.ts");
const req = (h: Record<string, string>) => new Request("http://x/", { headers: h });
test("byte ranges", () => {
  expect(byteRange(req({}), '"e"', 100)).toBe(null);
  expect(byteRange(req({ range: "bytes=0-1" }), '"e"', 100)).toEqual([0, 1]);
  expect(byteRange(req({ range: "bytes=10-" }), '"e"', 100)).toEqual([10, 99]);
  expect(byteRange(req({ range: "bytes=-20" }), '"e"', 100)).toEqual([80, 99]);
  expect(byteRange(req({ range: "bytes=50-500" }), '"e"', 100)).toEqual([50, 99]);
  expect(byteRange(req({ range: "bytes=100-" }), '"e"', 100)).toBe("unsatisfiable");
  expect(byteRange(req({ range: "bytes=0-1,5-6" }), '"e"', 100)).toBe(null);
  expect(byteRange(req({ range: "bytes=0-1", "if-range": '"old"' }), '"e"', 100)).toBe(null);
  expect(byteRange(req({ range: "bytes=0-1", "if-range": '"e"' }), '"e"', 100)).toEqual([0, 1]);
});
