// Who is calling this app. Inside a Hamstr crumb the proxy sets X-Hamstr-*
// (and drops any the browser sent). On a celld site with platform auth the
// router sets X-Celld-User-*. Elsewhere both are absent and the visitor is a
// guest. Trust these only when the platform in front of you overwrites them.

export type Visitor = {
	/** Stable id when signed in; null for guests. */
	id: string | null;
	/** Display name (decoded); "Guest" when absent. */
	name: string;
	/** Hamstr role (`owner`, a share-link role, …) or celld role; "" when none. */
	role: string;
	/** Hamstr crumb id, when running inside one. */
	crumbId: string | null;
	/** Hamstr session id, when running inside a crumb. */
	sessionId: string | null;
	/** True when Hamstr is calling the app's export path. */
	exporting: boolean;
	/** Whether this visitor holds a Hamstr permission id from hamstr.json. */
	can(permission: string): boolean;
};

function header(request: Request, name: string): string | null {
	return request.headers.get(name);
}

function decodeName(raw: string | null, fallback: string): string {
	if (!raw) return fallback;
	try {
		return decodeURIComponent(raw) || fallback;
	} catch {
		return fallback;
	}
}

/**
 * Read the visitor from request headers set by Hamstr or celld.
 * Prefers Hamstr headers when both are present.
 */
export function visitor(request: Request): Visitor {
	const hamstrId = header(request, "x-hamstr-user-id");
	const celldId = header(request, "x-celld-user-id");
	const id = hamstrId || celldId || null;

	const name = decodeName(
		header(request, "x-hamstr-username") ?? header(request, "x-celld-user-name"),
		"Guest",
	).slice(0, 60);

	const role = header(request, "x-hamstr-role") || header(request, "x-celld-user-role") || "";
	const perms = new Set(
		(header(request, "x-hamstr-permissions") ?? "")
			.split(",")
			.map((p) => p.trim())
			.filter(Boolean),
	);

	return {
		id,
		name,
		role,
		crumbId: header(request, "x-hamstr-crumb-id"),
		sessionId: header(request, "x-hamstr-session-id"),
		exporting: header(request, "x-hamstr-export") === "1",
		can: (permission) => perms.has(permission),
	};
}
