import { adminApi, body } from "#lib/server/accounts.ts";

export const PATCH = adminApi(async (event, user, c) => {
	const patch = await body(event);
	const id = event.params.id;
	const onlyActivate = patch.active === true && patch.url === undefined && patch.publicUrl === undefined && patch.name === undefined;
	return { store: onlyActivate ? c.activateStore(user.id, id) : c.saveStore(user.id, { ...patch, id }) };
});
export const DELETE = adminApi((event, user, c) => void c.deleteStore(user.id, event.params.id));
