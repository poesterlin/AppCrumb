import { guard, json, requireUser } from "#lib/server/http.ts";
import { backupName, saveBackupUpload, sendBackup } from "#lib/server/upload.ts";

/** Download a backup of a crumb: everything it stores, for any app. Owner only. */
// fallow-ignore-next-line code-duplication
export const GET = guard(async (event) => {
	const c = event.locals.core;
	const me = requireUser(event);
	// A download is a navigation from the shell (or a typed URL), never a
	// request another site makes on the owner's behalf.
	const site = event.request.headers.get("sec-fetch-site");
	if (site !== null && site !== "same-origin" && site !== "none") return json(c, 403, { error: "cross-origin request" });
	const crumb = c.q.crumb.get(event.params.id);
	if (!crumb || crumb.trashed_at || crumb.owner_id !== me.id) return json(c, 404, { error: "no such crumb" });
	if (c.isRestoring(crumb.id)) return json(c, 409, { error: "this item is being restored right now" });
	const { file } = await c.backupCrumb(crumb);
	return sendBackup(c, file, backupName(c, crumb.title));
});

/** Replace a crumb's data with an uploaded backup of it (or of another item of
 *  the same app). Owner only. */
export const PUT = guard(async (event) => {
	const c = event.locals.core;
	const me = requireUser(event);
	const crumb = c.q.crumb.get(event.params.id);
	if (!crumb || crumb.trashed_at || crumb.owner_id !== me.id) return json(c, 404, { error: "no such crumb" });
	const file = await saveBackupUpload(event);
	try {
		const result = await c.restoreCrumb(crumb, file);
		return json(c, 200, { ok: true, backup: { title: result.header.title, at: result.header.at, appVersion: result.header.appVersion } });
	} finally {
		c.releaseTemp(file);
	}
});
