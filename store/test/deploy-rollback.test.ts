// The deploy watch rolls back a bad version, but never over a newer deploy.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { deploy } from "../cli/deploy.ts";
import { bundle } from "./helpers.ts";

/** A node that records calls; `live` is what the site serves after our activation. */
function fakeNode(live: () => string | null, probe: number) {
	const calls: string[] = [];
	const client = {
		origin: "http://node.test",
		async admin(method: string, path: string) {
			calls.push(`${method} ${path}`);
			const json = (body: unknown) => ({ status: 200, text: JSON.stringify(body) });
			if (path.startsWith("/blobs/missing")) return json({ missing: [] });
			if (path.startsWith("/code")) return json({});
			if (path.startsWith("/check")) return json({ ok: true, status: 200, path: "/" });
			if (path.startsWith("/activate")) return json({ previous: "111111111111" });
			if (path === "/overview") return json({ sites: [{ id: "site.test", version: live(), aliases: [] }] });
			return json({});
		},
		async visit() {
			return { status: probe, text: "boom" };
		},
	};
	return { client, calls };
}
const quiet = () => {};

describe("deploy rollback", () => {
	it("rolls back to the previous version when the live site fails and is still this deploy", async () => {
		const tgz = await bundle({ version: "222222222222" });
		const node = fakeNode(() => "222222222222", 500);
		await assert.rejects(deploy(node.client, tgz, "site.test", { watch: 1, probeMs: 10, log: quiet }), /rolled back to 111111111111/);
		assert.ok(node.calls.includes("POST /activate?host=site.test&version=111111111111"));
	});

	it("leaves a newer deploy alone: it is not this deploy's to roll back", async () => {
		const tgz = await bundle({ version: "222222222222" });
		const node = fakeNode(() => "333333333333", 500);
		await assert.rejects(deploy(node.client, tgz, "site.test", { watch: 1, probeMs: 10, log: quiet }), /superseded|newer/);
		assert.ok(!node.calls.some((c) => c.includes("version=111111111111")), "no rollback over the newer version");
	});

	it("does not roll back when the live site stays healthy", async () => {
		const tgz = await bundle({ version: "222222222222" });
		const node = fakeNode(() => "222222222222", 200);
		const result = await deploy(node.client, tgz, "site.test", { watch: 1, probeMs: 10, log: quiet });
		assert.equal(result.previous, "111111111111");
		assert.ok(!node.calls.some((c) => c.includes("version=111111111111")));
	});
});
