import { adminApi, body } from "#lib/server/accounts.ts";

export const GET = adminApi((_e, _u, c) => ({ stores: c.storesList() }));
export const POST = adminApi(async (event, user, c) => ({ store: c.saveStore(user.id, await body(event)) }));
