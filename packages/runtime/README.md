# @hamstr/runtime

Small helpers for apps that run on [Hamstr](../../hamstr/README.md) /
[celld](../../docs/SITES.md). Use these instead of reading platform headers or
`env.OBJECTS` directly, so the same app can later target another workerd host
(for example Cloudflare Workers) behind a thin adapter.

```sh
npm install @hamstr/runtime
# in this repo's fixtures: "file:../../../../packages/runtime"
```

The package ships TypeScript source; `tools/pack.ts` (esbuild) bundles it into
the worker. Subpath imports (`@hamstr/runtime/visitor.ts`, …) keep unused
helpers out of the bundle.

```ts
import { visitor, objects, assets } from "@hamstr/runtime";

export default {
	async fetch(request, env) {
		const me = visitor(request);
		if (!me.can("pin")) return new Response("read only", { status: 403 });
		const pins = await objects.call("Board", "board", "list");
		// or: objects.from(env).call("Board", "board", "list")
		return Response.json({ me, pins });
	},
};
```

| Helper | What it does |
| --- | --- |
| `visitor(request)` | `{ id, name, role, crumbId, sessionId, exporting, can(perm) }` from Hamstr / celld headers; guest when absent |
| `objects.call(class, name, method, …args)` | `env.OBJECTS.call` via `cloudflare:workers` |
| `objects.from(env).call(…)` | same, with the `fetch` `env` argument |
| `assets.fetch(request \| url)` | `env.ASSETS.fetch` |
| `assets.from(env).fetch(…)` | same, with an explicit `env` |

v1 covers celld/Hamstr only. A Cloudflare adapter (real DO bindings, optional
auth) is intentionally out of scope here.

Plain TypeScript; no dependencies. Bundle it into the worker (esbuild does that
when you depend on this package from the app).

## Releasing to npm

Bump `version` in `package.json`, then tag and push (or run the **npm** workflow):

```sh
git tag runtime-v0.1.0
git push origin runtime-v0.1.0
```

Same trusted-publisher setup as `@hamstr/cli`: npmjs.com → package → Trusted
Publisher → this repo, workflow `npm.yml`. Optional repo secret `NPM_TOKEN` for
the first publish of a new package.
