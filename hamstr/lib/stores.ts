// Registered AppCrumb URLs for one Hamstr. One row is active; browse and Get
// use that origin. Each installed app remembers its source store for updates.
// HAMSTR_STORE seeds the first row on a fresh data directory; Settings owns
// the list after that.
import type { DatabaseSync } from "node:sqlite";

export interface StoreRow {
	id: string;
	url: string;
	publicUrl: string;
	name: string;
	active: boolean;
	createdAt: string;
}

export interface StoreInput {
	id?: string;
	url: string;
	publicUrl?: string;
	name?: string;
	active?: boolean;
}

interface StoresDeps {
	db: DatabaseSync;
	randomId: (length?: number) => string;
	now: () => string;
	audit: (actor: string, action: string, target: string, detail?: unknown) => void;
	HttpError: new (status: number, message: string) => Error & { status: number };
}

function withTx(db: DatabaseSync, body: () => void) {
	db.exec("BEGIN IMMEDIATE");
	try {
		body();
		db.exec("COMMIT");
	} catch (err) {
		db.exec("ROLLBACK");
		throw err;
	}
}

/** Ensure the stores table exists and seed it from the env URLs when empty. */
export function ensureStores(db: DatabaseSync, seed: { url: string; publicUrl: string }, randomId: (n?: number) => string, now: () => string) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS stores (
			id TEXT PRIMARY KEY,
			url TEXT NOT NULL UNIQUE,
			public_url TEXT NOT NULL,
			name TEXT NOT NULL,
			active INTEGER NOT NULL DEFAULT 0,
			created_at TEXT NOT NULL
		);
	`);
	if (db.prepare("SELECT COUNT(*) AS n FROM stores").get()?.n || !seed.url) return;
	let name = "Store";
	try {
		name = new URL(seed.url).hostname || name;
	} catch {}
	db.prepare("INSERT INTO stores (id, url, public_url, name, active, created_at) VALUES (?, ?, ?, ?, 1, ?)").run(
		randomId(12),
		seed.url,
		seed.publicUrl || seed.url,
		name,
		now(),
	);
}

export function createStores({ db, randomId, now, audit, HttpError }: StoresDeps) {
	function parseUrl(raw: unknown): string {
		const trimmed = String(raw ?? "").trim();
		if (!trimmed) throw new HttpError(400, "a store URL is required");
		let url: URL;
		try {
			url = new URL(trimmed);
		} catch {
			throw new HttpError(400, "bad store URL");
		}
		if (url.protocol !== "https:" && url.protocol !== "http:") throw new HttpError(400, "store URL must be http(s)");
		if (url.username || url.password) throw new HttpError(400, "store URL must not include credentials");
		return url.origin + url.pathname.replace(/\/+$/, "");
	}

	function rowOf(row: any): StoreRow | null {
		if (!row) return null;
		return { id: row.id, url: row.url, publicUrl: row.public_url, name: row.name, active: !!row.active, createdAt: row.created_at };
	}
	const get = (id: string) => db.prepare("SELECT * FROM stores WHERE id = ?").get(id);
	const list = () => db.prepare("SELECT * FROM stores ORDER BY lower(name), url").all().map(rowOf) as StoreRow[];
	const active = () => rowOf(db.prepare("SELECT * FROM stores WHERE active = 1 LIMIT 1").get());

	function setActive(id: string) {
		db.prepare("UPDATE stores SET active = 0").run();
		db.prepare("UPDATE stores SET active = 1 WHERE id = ?").run(id);
	}

	function label(url: string, name: string) {
		const trimmed = name.trim().slice(0, 40);
		if (trimmed) return trimmed;
		try {
			return new URL(url).hostname || "Store";
		} catch {
			return "Store";
		}
	}

	function activate(actor: string, id: string) {
		const row = get(id);
		if (!row) throw new HttpError(404, "no such store");
		withTx(db, () => setActive(id));
		audit(actor, "store.activate", id, { name: row.name, url: row.url });
		return rowOf(get(id));
	}

	function save(actor: string, input: StoreInput) {
		const url = parseUrl(input.url);
		const publicUrl = String(input.publicUrl ?? "").trim() ? parseUrl(input.publicUrl) : url;
		const name = label(url, String(input.name ?? ""));
		const existing = input.id ? get(input.id) : null;
		if (input.id && !existing) throw new HttpError(404, "no such store");
		if (db.prepare("SELECT id FROM stores WHERE url = ? AND id != ?").get(url, existing?.id ?? "")) {
			throw new HttpError(409, "that store URL is already registered");
		}
		const id = existing?.id ?? randomId(12);
		const makeActive = input.active === true || (!existing && !active());
		withTx(db, () => {
			if (existing) db.prepare("UPDATE stores SET url = ?, public_url = ?, name = ? WHERE id = ?").run(url, publicUrl, name, id);
			else db.prepare("INSERT INTO stores (id, url, public_url, name, active, created_at) VALUES (?, ?, ?, ?, 0, ?)").run(id, url, publicUrl, name, now());
			if (makeActive) setActive(id);
		});
		audit(actor, existing ? "store.update" : "store.create", id, { name, url });
		return rowOf(get(id));
	}

	function remove(actor: string, id: string) {
		const row = get(id);
		if (!row) throw new HttpError(404, "no such store");
		withTx(db, () => {
			db.prepare("DELETE FROM stores WHERE id = ?").run(id);
			if (row.active) {
				const next = db.prepare("SELECT id FROM stores ORDER BY created_at LIMIT 1").get() as { id: string } | undefined;
				if (next) setActive(next.id);
			}
		});
		audit(actor, "store.delete", id, { name: row.name, url: row.url });
	}

	return { list, get: (id: string) => rowOf(get(id)), active, activate, save, remove, parseUrl };
}
