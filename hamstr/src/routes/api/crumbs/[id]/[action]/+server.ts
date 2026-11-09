import { guard, json, readJson, requireSameOrigin, requireUser } from "#lib/server/http.ts";

export const POST = guard(async (event) => {
	const c = event.locals.core;
	const me = requireUser(event);
	requireSameOrigin(event);
	const crumb = c.q.crumb.get(event.params.id);
	if (!crumb) return json(c, 404, { error: "no such crumb" });
	const owner = crumb.owner_id === me.id;
	const access = c.accessFor(crumb, { userId: me.id });
	const action = event.params.action;

	if (action === "open") {
		if (!access) return json(c, 404, { error: "no such crumb" });
		const body = await readJson(event.request);
		return json(c, 200, { url: c.issueTicket(crumb, { userId: me.id, parent: event.locals.session.hash, path: body.path, host: event.request.headers.get("host") }) });
	}
	if (!owner) return json(c, crumb.trashed_at || !access ? 404 : 403, { error: "only the owner can do that" });

	if (action === "trash") {
		c.db.prepare("UPDATE crumbs SET trashed_at = ? WHERE id = ? AND trashed_at IS NULL").run(c.now(), crumb.id);
		c.db.prepare("DELETE FROM crumb_sessions WHERE crumb_id = ?").run(crumb.id);
		c.crumbsChanged();
		return json(c, 200, { ok: true });
	}
	if (action === "restore") {
		c.untrashCrumb(crumb);
		return json(c, 200, { ok: true });
	}
	if (action === "reset") {
		// Wipes the item's data for good: the body has to name the item.
		if (crumb.trashed_at) return json(c, 404, { error: "no such crumb" });
		if ((await readJson(event.request)).confirm !== crumb.id) return json(c, 400, { error: "say which item to reset (confirm: its id)" });
		await c.resetCrumb(crumb);
		return json(c, 200, { ok: true });
	}
	return json(c, 404, { error: "no such endpoint" });
});
