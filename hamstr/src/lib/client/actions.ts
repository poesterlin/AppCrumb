// What you can do with an app or an item, shared by Home, the app page, the
// store and their context menus, so every place offers the same things.
import { goto, invalidateAll } from "$app/navigation";
import { api } from "./api.ts";
import { downloadBackup, downloadCrumb } from "./download.ts";
import { askImport, askManage, askUninstall, oops, toast } from "./ui.svelte.ts";

/** Open an app: a single-instance app goes straight into its one item. */
export async function openApp(app) {
	if (app.instances !== "single") return goto(`/a/${app.slug}`);
	try {
		const { crumb } = await api(`/api/apps/${app.slug}/open`, { method: "POST", body: {} });
		await goto(`/c/${crumb.id}`);
	} catch (err) {
		oops(err);
	}
}

async function newItem(app) {
	try {
		const { crumb } = await api("/api/crumbs", { method: "POST", body: { slug: app.slug } });
		await goto(`/c/${crumb.id}`);
	} catch (err) {
		oops(err);
	}
}

export async function downloadItem(crumb) {
	toast(`Preparing “${crumb.title}”…`);
	try {
		toast(`Downloaded ${await downloadCrumb(crumb.id)}`);
	} catch (err) {
		oops(err);
	}
}

export async function backupItem(crumb) {
	toast(`Backing up “${crumb.title}”…`);
	try {
		toast(`Downloaded ${await downloadBackup(crumb.id)}`);
	} catch (err) {
		oops(err);
	}
}

export async function crumbAction(crumb, action, done) {
	try {
		await api(`/api/crumbs/${crumb.id}/${action}`, { method: "POST", body: {} });
		if (done) toast(done);
		await invalidateAll();
	} catch (err) {
		oops(err);
	}
}

/** The menu of an installed app. `here` leaves out the page you are on. */
export function appMenu(app, { admin = false, here = "" } = {}) {
	const many = app.instances !== "single";
	return [
		{ label: "Open", icon: "chevron", onclick: () => openApp(app) },
		{ label: `New ${app.name}`, icon: "plus", hidden: !many, onclick: () => newItem(app) },
		{ label: "All items", icon: "grid", hidden: !many || here === "app", separator: true, onclick: () => goto(`/a/${app.slug}`) },
		{ label: "Import a backup…", icon: "upload", hidden: !many, separator: here === "app", onclick: () => askImport(app) },
		{ label: "View in Store", icon: "info", hidden: here === "store", separator: !many || here === "app", onclick: () => goto(`/store/${app.storeId ?? app.slug}`) },
		{ label: "Uninstall…", icon: "trash", danger: true, separator: true, hidden: !admin, onclick: () => askUninstall(app) },
	];
}

/** The menu of an item (not trashed). Pass `rename` where renaming is possible,
 *  and the item's app (from the page's data) for managing its data. */
export function crumbMenu(crumb: any, { rename, app }: { rename?: any; app?: any } = {}) {
	return [
		{ label: "Open", icon: "chevron", onclick: () => goto(`/c/${crumb.id}`) },
		{ label: "Open in a new tab", icon: "external", onclick: () => window.open(`/c/${crumb.id}/open`, "_blank", "noopener") },
		{ label: "Rename…", icon: "pencil", separator: true, hidden: !rename, onclick: () => rename(crumb) },
		{ label: "Manage data…", icon: "download", separator: !rename, hidden: !app, onclick: () => askManage(crumb, app) },
		{ label: "Move to trash", icon: "trash", danger: true, separator: true, onclick: () => crumbAction(crumb, "trash", "Moved to the trash") },
	];
}
