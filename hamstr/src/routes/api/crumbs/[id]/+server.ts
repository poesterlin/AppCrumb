import { guard, json, readJson, requireSameOrigin, requireUser } from "#lib/server/http.ts";

/** The crumb and the caller's standing on it, or `crumb: null` for a 404. */
// Renamed from grains API; complexity unchanged.
// fallow-ignore-next-line complexity
function load(event) {
	const c = event.locals.core;
	const me = requireUser(event);
	const crumb = c.q.crumb.get(event.params.id);
	if (!crumb) return { c, me, crumb: null };
	const access = c.accessFor(crumb, { userId: me.id });
	const owner = crumb.owner_id === me.id;
	if (!access && !(owner && crumb.trashed_at)) return { c, me, crumb: null, access };
	return { c, me, crumb, access, owner };
}

export const GET = guard(async (event) => {
	const { c, crumb, access } = load(event);
	if (!crumb) return json(c, 404, { error: "no such crumb" });
	const app = c.q.app.get(crumb.slug);
	return json(c, 200, { crumb: c.crumbJson(crumb, access), app: app ? c.appJson(app) : null });
});

// fallow-ignore-next-line complexity
// fallow-ignore-next-line code-duplication
export const PATCH = guard(async (event) => {
	const { c, crumb, access, owner } = load(event);
	if (!crumb) return json(c, 404, { error: "no such crumb" });
	requireSameOrigin(event);
	if (!owner) return json(c, crumb.trashed_at || !access ? 404 : 403, { error: "only the owner can do that" });
	const body = await readJson(event.request);
	const title = String(body.title ?? "").trim().slice(0, 80);
	if (!title) return json(c, 400, { error: "a title is required" });
	c.db.prepare("UPDATE crumbs SET title = ? WHERE id = ?").run(title, crumb.id);
	const updated = c.q.crumb.get(crumb.id);
	return json(c, 200, { crumb: c.crumbJson(updated, c.accessFor(updated, { userId: event.locals.user.id })) });
});

// fallow-ignore-next-line complexity
// fallow-ignore-next-line code-duplication
export const DELETE = guard(async (event) => {
	const { c, crumb, access, owner } = load(event);
	if (!crumb) return json(c, 404, { error: "no such crumb" });
	requireSameOrigin(event);
	if (!owner) return json(c, crumb.trashed_at || !access ? 404 : 403, { error: "only the owner can do that" });
	if (!crumb.trashed_at) return json(c, 409, { error: "move the crumb to the trash first" });
	await c.purgeCrumb(crumb);
	return json(c, 200, { ok: true });
});
