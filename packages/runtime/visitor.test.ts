import assert from "node:assert/strict";
import { test } from "node:test";
import { visitor } from "./visitor.ts";

const req = (headers: Record<string, string> = {}) => new Request("https://app.test/", { headers });

test("guest when no identity headers", () => {
	const me = visitor(req());
	assert.equal(me.id, null);
	assert.equal(me.name, "Guest");
	assert.equal(me.role, "");
	assert.equal(me.crumbId, null);
	assert.equal(me.sessionId, null);
	assert.equal(me.exporting, false);
	assert.equal(me.can("pin"), false);
});

test("Hamstr headers", () => {
	const me = visitor(
		req({
			"x-hamstr-user-id": "abc",
			"x-hamstr-username": "Ada%20Lovelace",
			"x-hamstr-permissions": "pin, moderate",
			"x-hamstr-role": "owner",
			"x-hamstr-crumb-id": "crumb-1",
			"x-hamstr-session-id": "sess",
			"x-hamstr-export": "1",
		}),
	);
	assert.equal(me.id, "abc");
	assert.equal(me.name, "Ada Lovelace");
	assert.equal(me.role, "owner");
	assert.equal(me.crumbId, "crumb-1");
	assert.equal(me.sessionId, "sess");
	assert.equal(me.exporting, true);
	assert.equal(me.can("pin"), true);
	assert.equal(me.can("moderate"), true);
	assert.equal(me.can("admin"), false);
});

test("celld auth headers when Hamstr is absent", () => {
	const me = visitor(
		req({
			"x-celld-user-id": "u1",
			"x-celld-user-name": "Grace%20Hopper",
			"x-celld-user-role": "admin",
		}),
	);
	assert.equal(me.id, "u1");
	assert.equal(me.name, "Grace Hopper");
	assert.equal(me.role, "admin");
	assert.equal(me.can("pin"), false);
});

test("Hamstr wins over celld when both are set", () => {
	const me = visitor(
		req({
			"x-hamstr-user-id": "hamstr",
			"x-hamstr-username": "Hamstr",
			"x-celld-user-id": "celld",
			"x-celld-user-name": "Celld",
		}),
	);
	assert.equal(me.id, "hamstr");
	assert.equal(me.name, "Hamstr");
});

test("bad percent-encoding falls back to Guest", () => {
	assert.equal(visitor(req({ "x-hamstr-username": "%E0%A4%A" })).name, "Guest");
});
