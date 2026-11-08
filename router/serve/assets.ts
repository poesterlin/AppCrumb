import { WorkerEntrypoint } from "cloudflare:workers";
import type { Env } from "../env.ts";
import { badAssetPath, siteMeta } from "./meta.ts";

/** File bytes. Blobs never change and an old-format version's files don't either,
 *  so any file can be cached; small ones are kept in memory (LRU, bounded) per
 *  router isolate, keyed by storage key (so files shared by versions are cached once). */
const ASSET_CACHE_BYTES = 32 * 1024 * 1024;
const ASSET_CACHE_MAX_ENTRY = 1024 * 1024;
const assetCache = new Map(); // storage key -> { value, type }
let assetCacheBytes = 0;

async function readAsset(env, meta, version, path) {
	const blob = meta.files?.[path];
	const key = blob ? `blob:${blob[0]}` : `asset:${version}:${path}`;
	let hit = assetCache.get(key);
	if (hit) {
		assetCache.delete(key); // most recently used goes last
		assetCache.set(key, hit);
	} else {
		const { value, metadata } = await env.CODE.getWithMetadata(key, "arrayBuffer");
		if (value === null) return null;
		hit = { value, type: metadata?.type };
		if (value.byteLength <= ASSET_CACHE_MAX_ENTRY) {
			assetCache.set(key, hit);
			assetCacheBytes += value.byteLength;
			for (const [k, e] of assetCache) {
				if (assetCacheBytes <= ASSET_CACHE_BYTES) break;
				assetCache.delete(k);
				assetCacheBytes -= e.value.byteLength;
			}
		}
	}
	return { value: hit.value, type: (blob ? blob[1] : hit.type) ?? "application/octet-stream" };
}

/** Whether a path gets the 1-year immutable cache: under an immutable prefix and
 *  not one of the exact paths that change between builds. */
const isImmutable = (cache, path) => cache.immutable.some((p) => path.startsWith(p)) && !cache.mutable.includes(path);

/** Strong validator: the content hash, so a file that didn't change between
 *  versions keeps its ETag across deploys. Old-format versions use version:path. */
const etagFor = (meta, version, path) => {
	const blob = meta.files?.[path];
	return blob ? `"${blob[0].slice(0, 32)}"` : `"${version}:${encodeURIComponent(path)}"`;
};

function notModified(request, etag) {
	const header = request?.headers.get("if-none-match");
	if (!header) return false;
	return header.split(",").some((t) => {
		t = t.trim();
		return t === "*" || t === etag || t === `W/${etag}`;
	});
}

/** One static file of a version, or null if it does not exist. `known` means the
 *  caller checked the version's file list, so a matching If-None-Match can be
 *  answered with 304 without reading the file. */
interface AssetOptions { head?: boolean; status?: number; request?: Request; known?: boolean }
export async function assetResponse(env: any, version: string, path: string, meta: any, { head = false, status = 200, request, known = false }: AssetOptions = {}) {
	const headers: Record<string, string> = { "cache-control": isImmutable(meta, path) ? "public, immutable, max-age=31536000" : "no-cache" };
	if (status === 200) {
		headers.etag = etagFor(meta, version, path);
		if (known && notModified(request, headers.etag)) return new Response(null, { status: 304, headers });
	}
	const file = await readAsset(env, meta, version, path);
	if (file === null) return null;
	if (status === 200 && notModified(request, headers.etag)) return new Response(null, { status: 304, headers });
	headers["content-type"] = safeContentType(file.type);
	if (status === 200) {
		const partial = rangeResponse(request, headers, file.value, head);
		if (partial) return partial;
	}
	headers["content-length"] = String(file.value.byteLength);
	return new Response(head ? null : file.value, { status, headers });
}

/** The 206 or 416 answer to a Range request, or null to send the whole file.
 *  Sets `accept-ranges` on `headers` either way. */
function rangeResponse(request: Request | undefined, headers: Record<string, string>, value: ArrayBuffer, head: boolean): Response | null {
	headers["accept-ranges"] = "bytes";
	// One byte range (Safari won't play <video> without 206 answers). Multiple
	// ranges, or an If-Range for another version, get the whole file.
	const size = value.byteLength;
	const range = byteRange(request, headers.etag, size);
	if (range === "unsatisfiable") return new Response(null, { status: 416, headers: { ...headers, "content-range": `bytes */${size}` } });
	if (!range) return null;
	const [start, end] = range;
	headers["content-range"] = `bytes ${start}-${end}/${size}`;
	headers["content-length"] = String(end - start + 1);
	return new Response(head ? null : value.slice(start, end + 1), { status: 206, headers });
}

/** The single byte range a request asks for, as [first, last] (inclusive), or
 *  null for the whole file. */
export function byteRange(request: Request | undefined, etag: string, size: number): [number, number] | "unsatisfiable" | null {
	const header = request?.headers.get("range");
	if (!header) return null;
	const ifRange = request?.headers.get("if-range");
	if (ifRange && ifRange.trim() !== etag) return null;
	const m = header.trim().match(/^bytes=(\d*)-(\d*)$/);
	if (!m || (m[1] === "" && m[2] === "")) return null;
	let start: number, end: number;
	if (m[1] === "") {
		const suffix = Number(m[2]); // last N bytes
		if (suffix === 0) return "unsatisfiable";
		start = Math.max(0, size - suffix);
		end = size - 1;
	} else {
		start = Number(m[1]);
		end = m[2] === "" ? size - 1 : Math.min(Number(m[2]), size - 1);
		if (start > end || start >= size) return "unsatisfiable";
	}
	return [start, end];
}

/** A stored content type is served as a header only if it is printable ASCII;
 *  an old record with CR/LF or control characters falls back to octet-stream. */
const safeContentType = (t) => (typeof t === "string" && t.length <= 200 && /^[\x20-\x7e]+$/.test(t) ? t : "application/octet-stream");

/** The ASSETS binding handed to each site: serves only that version's files. */
export class SiteAssets extends WorkerEntrypoint<Env> {
	// fallow-ignore-next-line unused-class-member
	async fetch(request) {
		let path;
		try {
			path = decodeURIComponent(new URL(request.url).pathname).replace(/^\/+/, "");
		} catch {
			return new Response("Bad path", { status: 400 });
		}
		if (badAssetPath(path)) return new Response("Bad path", { status: 400 });
		const { version } = this.ctx.props;
		const meta = await siteMeta(this.env, version);
		if (!meta.legacy && !meta.assets.has(path)) return new Response("Not found", { status: 404 });
		const opts = { head: request.method === "HEAD", request, known: !meta.legacy };
		return (await assetResponse(this.env, version, path, meta, opts)) ?? new Response("Not found", { status: 404 });
	}
}
