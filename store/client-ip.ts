// Visitor address for rate limits.
//
// A reverse proxy can set STORE_CLIENT_IP_HEADER (e.g. X-Real-Ip) to the real
// client. That header is forgeable by anyone who can open a TCP connection to
// the store (another container on the same Docker network), so we only honour
// it when the request is attested:
//
//   1. STORE_PROXY_SECRET is set and the proxy adds matching X-Hamstr-Proxy
//      (Traefik: headers.customrequestheaders), or
//   2. the TCP peer is listed in STORE_TRUSTED_PROXIES (CIDRs / IPs), or
//   3. the peer is loopback (unit tests bind to 127.0.0.1).
//
// Otherwise the TCP peer address is used and client-supplied forwarding
// headers are ignored.

import { timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

const PROXY_SECRET_HEADER = "x-hamstr-proxy";

export type ClientIpOptions = {
	/** Header the proxy sets to the visitor address (lower-case). Empty = never. */
	clientIpHeader?: string;
	/** Shared secret the proxy must send in X-Hamstr-Proxy. */
	proxySecret?: string;
	/** CIDRs or bare IPs of proxies allowed to set the client-IP header. */
	trustedProxies?: string[];
};

export function parseTrustedProxies(raw: string | undefined): string[] {
	return String(raw ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
}

/** Strip IPv4-mapped and zone suffixes; Node often gives :ffff:1.2.3.4. */
function normalizeIp(addr: string | undefined | null): string {
	let s = String(addr ?? "").trim();
	if (!s) return "";
	if (s.startsWith("::ffff:")) s = s.slice(7);
	const zone = s.indexOf("%");
	if (zone >= 0) s = s.slice(0, zone);
	return s;
}

function isLoopback(ip: string): boolean {
	const n = normalizeIp(ip);
	return n === "127.0.0.1" || n === "::1" || n.startsWith("127.");
}

function ipv4ToInt(ip: string): number | null {
	const parts = ip.split(".");
	if (parts.length !== 4) return null;
	let n = 0;
	for (const p of parts) {
		const o = Number(p);
		if (!Number.isInteger(o) || o < 0 || o > 255) return null;
		n = (n << 8) | o;
	}
	return n >>> 0;
}

function ipv4InCidr(ip: string, cidr: string): boolean {
	const [base, bitsStr] = cidr.split("/");
	const bits = bitsStr === undefined ? 32 : Number(bitsStr);
	if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false;
	const a = ipv4ToInt(normalizeIp(ip));
	const b = ipv4ToInt(normalizeIp(base));
	if (a === null || b === null) return false;
	if (bits === 0) return true;
	const mask = bits === 32 ? 0xffffffff : (~((1 << (32 - bits)) - 1)) >>> 0;
	return (a & mask) === (b & mask);
}

/** True when `ip` equals an entry or falls in a CIDR (IPv4 only for CIDRs). */
function ipMatchesTrusted(ip: string, trusted: string[]): boolean {
	const n = normalizeIp(ip);
	if (!n || !trusted.length) return false;
	for (const entry of trusted) {
		const e = entry.trim();
		if (!e) continue;
		if (e.includes("/")) {
			if (isIP(n) === 4 && ipv4InCidr(n, e)) return true;
			continue;
		}
		if (normalizeIp(e) === n) return true;
	}
	return false;
}

function secretOk(req: IncomingMessage, secret: string): boolean {
	if (!secret) return false;
	const got = String(req.headers[PROXY_SECRET_HEADER] ?? "");
	if (!got || got.length !== secret.length) return false;
	try {
		return timingSafeEqual(Buffer.from(got), Buffer.from(secret));
	} catch {
		return false;
	}
}

function peerIsAttested(req: IncomingMessage, options: ClientIpOptions): boolean {
	const remote = normalizeIp(req.socket.remoteAddress);
	if (options.proxySecret && secretOk(req, options.proxySecret)) return true;
	if (options.trustedProxies?.length && ipMatchesTrusted(remote, options.trustedProxies)) return true;
	if (isLoopback(remote)) return true;
	return false;
}

/**
 * Address to key rate limits on. Prefer the proxy-attested visitor address;
 * otherwise the TCP peer.
 */
export function clientIp(req: IncomingMessage, options: ClientIpOptions = {}): string {
	const remote = normalizeIp(req.socket.remoteAddress) || "?";
	if (!peerIsAttested(req, options)) return remote;

	const header = options.clientIpHeader?.toLowerCase() ?? "";
	if (header) {
		const claimed = String(req.headers[header] ?? "").trim();
		if (claimed && isIP(normalizeIp(claimed))) return normalizeIp(claimed);
		if (claimed) return claimed; // hostnames are unusual but keep prior behaviour
	}
	const forwarded = String(req.headers["x-forwarded-for"] ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter(Boolean);
	if (forwarded.length) return normalizeIp(forwarded[forwarded.length - 1]) || forwarded[forwarded.length - 1];
	return remote;
}
