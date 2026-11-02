export function load({ locals }) {
	const c = locals.core;
	if (!locals.user) return { signedOut: true };
	const me = locals.user;
	const mine = c.db.prepare("SELECT * FROM crumbs WHERE owner_id = ? ORDER BY COALESCE(opened_at, created_at) DESC").all(me.id);
	return { trash: mine.filter((g) => g.trashed_at).map((g) => c.crumbJson(g, null)) };
}
