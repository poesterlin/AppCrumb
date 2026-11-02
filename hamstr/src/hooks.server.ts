// One process answers two kinds of hostname:
//   HAMSTR_HOST            the shell: UI, JSON API, sign-in
//   crumb-<id>.<domain>    a crumb: /.hamstr/enter, then everything is proxied
// Anything else is not ours. This hook routes on the Host header before
// SvelteKit's router, and adds the shell's security headers to every answer.
import { core } from "#lib/server/instance.ts";
import { csp, cspExtras, frameAncestors, json } from "#lib/server/http.ts";
import { crumbRequest } from "../lib/proxy.ts";

const BODYLESS = new Set([101, 204, 205, 304]);

function withShellHeaders(c, response) {
	const headers = new Headers(response.headers);
	headers.set("x-content-type-options", "nosniff");
	// Chromium sends `Origin: null` on form posts under no-referrer, which would
	// defeat the same-origin checks.
	if (!headers.has("referrer-policy")) headers.set("referrer-policy", "same-origin");
	if (c.home) headers.delete("x-frame-options");
	else headers.set("x-frame-options", "DENY");
	const existing = headers.get("content-security-policy");
	if (!existing) headers.set("content-security-policy", csp(c));
	else {
		let next = existing;
		if (!next.includes("frame-src")) next = `${next}; ${cspExtras(c).join("; ")}`;
		// kitOptions bakes frame-ancestors 'none' into rendered pages; home mode
		// must allow the Home Assistant sidebar to frame the shell.
		if (/frame-ancestors\s/.test(next)) next = next.replace(/frame-ancestors\s[^;]+/, `frame-ancestors ${frameAncestors(c)}`);
		else next = `${next}; frame-ancestors ${frameAncestors(c)}`;
		headers.set("content-security-policy", next);
	}
	return new Response(BODYLESS.has(response.status) ? null : response.body, {
		status: response.status,
		statusText: response.statusText,
		headers,
	});
}

export async function handle({ event, resolve }) {
	const c = core();
	event.locals.core = c;
	event.locals.user = null;
	event.locals.session = null;

	const host = (event.request.headers.get("host") ?? "")
		.toLowerCase()
		.replace(/:\d+$/, "");
	const crumb = c.crumbPattern.exec(host);
	if (crumb) return crumbRequest(event, crumb[1]);
	// Home mode: the shell answers on any hostname (an IP, homeassistant.local…).
	if (host !== c.config.shellHost && !c.home) {
		if (event.url.pathname === "/api/health") return json(c, 200, { ok: true });
		return new Response("unknown host\n", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
	}

	const session = c.sessionFor(event.request);
	event.locals.session = session;
	event.locals.user = session?.user ?? null;

	return withShellHeaders(c, await resolve(event));
}
