// Static files for this site, via celld's ASSETS binding (or the same shape
// on another workerd host).

import { env } from "cloudflare:workers";

type AssetsBinding = { fetch(request: Request | string): Promise<Response> };
type EnvWithAssets = { ASSETS: AssetsBinding };

function binding(explicit?: EnvWithAssets): AssetsBinding {
	const assets = (explicit ?? (env as EnvWithAssets)).ASSETS;
	if (!assets?.fetch) throw new Error("@hamstr/runtime: env.ASSETS.fetch is not available");
	return assets;
}

/** Fetch a static file from this site's assets. */
export function fetchAsset(request: Request | string): Promise<Response> {
	return binding().fetch(request);
}

export const assets = {
	fetch: fetchAsset,
	from(explicit: EnvWithAssets) {
		return {
			fetch(request: Request | string): Promise<Response> {
				return binding(explicit).fetch(request);
			},
		};
	},
};
