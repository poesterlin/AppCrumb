import { redirect } from "@sveltejs/kit";
import { guard, html, page } from "#lib/server/http.ts";

/** Open a crumb at top level (new tab, or recovering an expired crumb session). */
export const GET = guard(async (event) => {
	const c = event.locals.core;
	if (!event.locals.user) {
		const next = `${event.url.pathname}${event.url.search}`;
		throw redirect(303, `/auth/login?next=${encodeURIComponent(next)}`);
	}
	const crumb = c.q.crumb.get(event.params.id);
	if (!c.accessFor(crumb, { userId: event.locals.user.id })) {
		const body = `<h1>No such crumb</h1><p><a class="button" href="/">Home</a></p>`;
		return html(c, 404, page("Not found", body));
	}
	const location = c.issueTicket(crumb, {
		userId: event.locals.user.id,
		parent: event.locals.session.hash,
		path: event.url.searchParams.get("path") ?? "/",
		host: event.request.headers.get("host")
	});
	return new Response(null, { status: 303, headers: { location, "cache-control": "no-store" } });
});
