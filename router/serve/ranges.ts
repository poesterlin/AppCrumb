// Kept apart from assets.ts (no cloudflare:workers import) so it can be
// tested under plain Node: node --test tests/ranges.test.ts

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
