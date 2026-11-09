import { adminApi } from "#lib/server/accounts.ts";
import { HttpError } from "#lib/server/core.ts";

/** Sync now: the machine, the shell and one service per live crumb. */
export const POST = adminApi(async (_e, _u, c) => {
	if (!c.tailnet) throw new HttpError(409, "Tailscale names are for home mode.");
	await c.tailnet.sync();
	return c.tailnet.status();
});
