import { adminApi, body } from "#lib/server/accounts.ts";

export const GET = adminApi((_e, _u, c) => c.homeNetwork());
export const PUT = adminApi(async (event, _u, c) => c.setHomeNetwork(await body(event), event.request.headers.get("host") ?? ""));
