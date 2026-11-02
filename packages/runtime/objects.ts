// Durable Object calls through celld's OBJECTS binding.
// On Cloudflare later, a small adapter can map the same call shape onto
// per-class DO namespaces without changing app code.

import { env } from "cloudflare:workers";

type ObjectsBinding = {
	call(className: string, name: string, method: string, ...args: unknown[]): Promise<unknown>;
};

type EnvWithObjects = { OBJECTS: ObjectsBinding };

function binding(explicit?: EnvWithObjects): ObjectsBinding {
	const objects = (explicit ?? (env as EnvWithObjects)).OBJECTS;
	if (!objects?.call) throw new Error("@hamstr/runtime: env.OBJECTS.call is not available");
	return objects;
}

/** Call `method` on the Durable Object `className` named `name`. */
export function callObject<T = unknown>(className: string, name: string, method: string, ...args: unknown[]): Promise<T> {
	return binding().call(className, name, method, ...args) as Promise<T>;
}

export const objects = {
	call: callObject,
	/** Bind calls to an explicit `env` (the `fetch` argument) instead of `cloudflare:workers`. */
	from(explicit: EnvWithObjects) {
		return {
			call<T = unknown>(className: string, name: string, method: string, ...args: unknown[]): Promise<T> {
				return binding(explicit).call(className, name, method, ...args) as Promise<T>;
			},
		};
	},
};
