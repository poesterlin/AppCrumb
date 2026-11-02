// Minimal OIDC client for the moderation site (discovery + PKCE + code grant).
// Same shape as hamstr/lib/auth/providers.ts, kept here so the store image does
// not depend on the hamstr package.
import { createHash, randomBytes } from "node:crypto";
import * as oidc from "openid-client";

export class OidcError extends Error {}

export function pkce() {
	const verifier = randomBytes(32).toString("base64url");
	return { verifier, challenge: createHash("sha256").update(verifier).digest("base64url") };
}

export interface OidcProfile {
	subject: string;
	email: string | null;
	name: string;
	username: string | null;
}

export interface OidcConfig {
	issuer: string;
	clientId: string;
	clientSecret: string;
	redirectUri: string;
	scope?: string;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

// Intentionally mirrors hamstr/lib/auth/providers.ts so the store image does
// not depend on the hamstr package. Keep in sync when changing either side.
// fallow-ignore-next-line code-duplication
function profileFromClaims(claims: Record<string, unknown>): OidcProfile {
	const email = str(claims.email)?.toLowerCase() ?? null;
	const username = str(claims.preferred_username) ?? str(claims.username) ?? str(claims.login);
	const name = str(claims.name) ?? username ?? (email ? email.split("@")[0] : null) ?? "Someone";
	return {
		subject: String(claims.sub),
		email,
		name: name.slice(0, 80),
		username,
	};
}

const loopback = (url: URL) => url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);

// fallow-ignore-next-line code-duplication
export function createOidc(config: OidcConfig) {
	const issuer = new URL(config.issuer);
	let discovered: Promise<oidc.Configuration> | undefined;
	// fallow-ignore-next-line code-duplication
	const discover = () =>
		(discovered ??= (async () => {
			const options = { timeout: 10, execute: loopback(issuer) ? [oidc.allowInsecureRequests] : [] };
			const found = await oidc.discovery(issuer, config.clientId, undefined, undefined, options);
			const methods = found.serverMetadata().token_endpoint_auth_methods_supported;
			const auth = !methods || methods.includes("client_secret_basic") ? oidc.ClientSecretBasic(config.clientSecret) : oidc.ClientSecretPost(config.clientSecret);
			const ready = new oidc.Configuration(found.serverMetadata(), config.clientId, config.clientSecret, auth);
			if (loopback(issuer)) oidc.allowInsecureRequests(ready);
			return ready;
		})().catch((err) => {
			discovered = undefined;
			throw new OidcError(`the issuer could not be reached: ${err.message}`);
		}));
	return {
		async start({ state, nonce, challenge }: { state: string; nonce: string; challenge: string }) {
			return oidc.buildAuthorizationUrl(await discover(), {
				redirect_uri: config.redirectUri,
				scope: config.scope || "openid profile email",
				state,
				nonce,
				code_challenge: challenge,
				code_challenge_method: "S256",
			}).href;
		},
		// fallow-ignore-next-line code-duplication
		async finish({ params, state, verifier, nonce }: { params: URLSearchParams; state: string; verifier: string; nonce: string }) {
			const cfg = await discover();
			const back = new URL(config.redirectUri);
			back.search = params.toString();
			let tokens: Awaited<ReturnType<typeof oidc.authorizationCodeGrant>>;
			try {
				tokens = await oidc.authorizationCodeGrant(cfg, back, {
					pkceCodeVerifier: verifier,
					expectedNonce: nonce,
					expectedState: state,
					idTokenExpected: true,
				});
			} catch (err) {
				throw new OidcError(`the provider's answer did not check out: ${(err as Error).message}`);
			}
			const claims: Record<string, unknown> = { ...tokens.claims() };
			if (tokens.access_token && cfg.serverMetadata().userinfo_endpoint) {
				const info = await oidc.fetchUserInfo(cfg, tokens.access_token, String(claims.sub)).catch(() => null);
				if (info) Object.assign(claims, info, { sub: claims.sub });
			}
			return profileFromClaims(claims);
		},
		check: async () => String((await discover()).serverMetadata().issuer),
	};
}

/** True when the profile matches a comma-separated allow list of emails, usernames or subjects. Empty list = anyone. */
export function profileAllowed(profile: OidcProfile, allow: string[]): boolean {
	if (!allow.length) return true;
	const keys = [profile.email, profile.username, profile.subject]
		.filter(Boolean)
		.map((s) => String(s).toLowerCase());
	return allow.some((a) => keys.includes(a.toLowerCase()));
}
