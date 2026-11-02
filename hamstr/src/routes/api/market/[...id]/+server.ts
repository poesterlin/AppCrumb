import { guard, json, requireUser } from "#lib/server/http.ts";

export const GET = guard(async (event) => {
	const c = event.locals.core;
	requireUser(event);
	const id = event.params.id;
	const installed = id.includes("/") ? c.q.appByStoreId.get(id) : c.q.app.get(id);
	return json(c, 200, await c.storeJson(`/api/v1/apps/${c.storePath(id)}`, c.storeForApp(installed)));
});
