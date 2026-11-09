// Home mode: Hamstr's own machine on a tailnet, and a Tailscale Service per crumb
// (Settings → Addresses → Tailscale). The client secret is write-only.
import { adminApi, body } from "#lib/server/accounts.ts";
import { HttpError } from "#lib/server/core.ts";

const manager = (c) => {
	if (!c.tailnet) throw new HttpError(409, "Tailscale names are for home mode.");
	return c.tailnet;
};
const host = (event) => event.request.headers.get("host") ?? "";

export const GET = adminApi((_e, _u, c) => manager(c).status());
export const PUT = adminApi(async (event, _u, c) => {
	c.requireHomeSettingsHost(host(event));
	return manager(c).connect(await body(event));
});
export const DELETE = adminApi((event, _u, c) => {
	c.requireHomeSettingsHost(host(event));
	return manager(c).disconnect();
});
