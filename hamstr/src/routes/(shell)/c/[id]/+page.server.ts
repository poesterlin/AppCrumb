// Renamed from /g/[id]; complexity unchanged.
// fallow-ignore-next-line complexity
export function load({ locals, params }) {
	const c = locals.core;
	if (!locals.user) return { signedOut: true };
	const me = locals.user;
	const crumb = c.q.crumb.get(params.id);
	if (!crumb) return { missing: true };
	const access = c.accessFor(crumb, { userId: me.id });
	const owner = crumb.owner_id === me.id;
	if (!access && !(owner && crumb.trashed_at)) return { missing: true };
	const app = c.q.app.get(crumb.slug);
	return { crumb: c.crumbJson(crumb, access), app: app ? c.appJson(app) : null };
}
