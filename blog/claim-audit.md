# Claim audit: "App Store for Sandboxed Local Apps"

Checked on 2026-11-02 against the repository at
`/home/lab/projects/services/celld-sites` (commit `1e3c3f7`, celld `0.6.3`).
The source conversation ends after the Excalidraw section; I did not edit
claims beyond that point.

**Verdicts**

- `cut`: removed from the post.
- `prove`: kept, but rewritten with a link, command, path or number.
- `keep`: kept as a premise, opinion or unchanged fact.

## Architecture and packaging

| Claim in the source | Verdict | Why |
| --- | --- | --- |
| celld launched by Ryan Dahl and the Deno team in August 2026. | `cut` | The celld README has no launch date, and the date is not needed to explain the runtime. |
| A standard celld fleet runs one application; multi-tenancy and ingress routing are out of scope. | `prove` | The celld README says "A fleet runs one application". `router/index.ts` is that application and adds hostname routing. The post says "one node runs every site". |
| Every cell is a V8 isolate with its own SQLite database, replicated through LTX. | `prove` | The celld README confirms LTX and SQLite. The post says each site is a V8 isolate and the SQLite state lands in an S3-compatible bucket. |
| Every app has its own SQLite database, a clean `.sqlite` file. | `cut` | Each Durable Object is a SQLite database. One crumb can create up to 1000 objects (`SITE_MAX_OBJECTS`). The post says "Durable Objects, each with a SQLite database". |
| The folder name becomes the URL. | `cut` | A crumb gets `crumb-<id>.<domain>`. Home mode gives it a port. A plain site is deployed to a hostname you choose. The post states all three. |
| An app is `cell.json`, `worker.js` and `public/`. | `prove` | The manifest is `hamstr.json`. The bundle is a tar.gz with `code.json` and `blobs/<sha256>`. A static directory is optional. |
| The manifest carries `egress`, `max_memory_mb` and `allow_alarms`. | `cut` | The real `hamstr.json` has `egress`, `devices`, `instances`, `export` and crumb `permissions`. There is no memory or alarm permission. |
| The store is a celld app at `apps/store/`. | `cut` | The store is a separate Node service with a SvelteKit UI and Postgres. It never runs app code (`store/README.md`). |
| The store fetches a registry from GitHub and calls a privileged local daemon API. | `cut` | The store has its own Postgres catalog and API. The installer (Hamstr or the CLI) holds the node's admin token; the store never does. |
| `mycelld publish` strips local SQLite state from the bundle. | `cut` | `hamstr publish` builds, packs and uploads. The bundle holds code and assets, not runtime data. There is no strip step. |
| An AI `SKILL.md` template and a "Share to Store" button. | `cut` | Not implemented. |
| A "Fork & instance" button. | `prove` | A new crumb is the isolated instance. There is no fork button, but the model exists. |
| A one-click SQLite backup and a CSV/JSON data inspector. | `prove` | `.hamstr-backup` download/restore and an app `export` path exist. There is no table inspector. |
| Zero-config backups through LTX and S3. | `cut` | The state is in an S3-compatible bucket, but backups are the operator's job (`docs/SECURITY.md`). |
| Multiple instances by copying the folder. | `prove` | Making another crumb creates another site with its own data. |
| Subdomains are needed so apps do not share cookies. | `keep` | Each crumb is its own origin. The site cookie is host-only. Home mode uses separate ports instead. |

## Security

| Claim in the source | Verdict | Why |
| --- | --- | --- |
| celld's internal operator API has unauthenticated `/shutdown` and similar routes. | `cut` | Not validated, and not needed for the post. The platform's admin API is token-gated on `admin.internal`. |
| WorkerLoader cross-app cell addressing, upstream issue #192. | `cut` | Not validated. |
| Build-time esbuild and `package.json` scripts can run shell commands. | `prove` | The deploy path runs `npm run build` on the host. The store deliberately does not build. The post says the store never builds an upload. |
| V8 memory exhaustion, `while(true)`, `CELLD_MAX_RSS_MB`. | `prove` | The platform caps CPU per request and object count, not bytes or memory. The post says sites share one process and there are no byte quotas. |
| Wakes in 4 ms and uses 0.47 MB or 0.5 MB. | `cut` | No cold-start measurement exists. The store README calls 4 ms a goal, not a measured promise. The post says so. |
| Idle apps use 0 MB, and 500 apps can be installed. | `cut` | "0 MB" is true before the first open and after celld sheds the isolate. A warm isolate stays resident. 500 apps is unmeasured. The post says "idle apps can be shed". |
| Hibernating WebSockets, realtime multiplayer and Durable Object alarms. | `cut` | celld supports both upstream. The router's `OBJECTS.call` binding and `docs/SITES.md` do not. Apps poll or refresh. The post says so. |
| Truly sandboxed; a tool physically cannot phone home. | `cut` | Server egress is blocked by default, but the isolate is not a hostile-app sandbox. Sites share one process, heap and disk. Hamstr's CSP covers connections and form posts, not navigation. The post states all three. |
| No signups. | `prove` | There is no account per app. Hamstr signs people in. Store accounts exist only for publishers. |
| Your data is yours, 100% local. | `prove` | Data is in the local S3 bucket and the store never sees it. The operator can read it, and the platform does not encrypt it. The post states both. |
| Zero hosting cost for the creator. | `keep` | The store never runs app code; the user's node does. |

## Market and product

| Claim in the source | Verdict | Why |
| --- | --- | --- |
| A public or official store exists. | `cut` | The store and moderation code exist and have tests. No public instance resolved on 2026-11-02. The post says the catalog is a prototype. |
| celld is around v0.6.x, and issue #192 matters. | `prove` | The node pins celld `0.6.3` (`node/Dockerfile`). |
| Excalidraw needs 3 containers, 250 MB, 100 lines and 200 boards. | `cut` | The numbers are unverified. A local Excalidraw port exists in the working tree but is not public. The post does not use it. |
| Sandstorm 2.0, with 4 ms wakes and 0.47 MB isolates. | `cut` | The comparison is kept as "close to Sandstorm". The numbers are cut with the other cold-start claims. |
| OpenQuick, open-cloud, Conjure-OS, open-mcp-apps and TreeOS. | `cut` | Not verified, and not needed to make the argument. |
| Umbrel and CasaOS apps use 100-500 MB each. | `cut` | The specific numbers are unverified. The post keeps the general "twenty containers" problem. |
| Every app is open source; edit two lines and hit save. | `cut` | The license comes from the manifest and can be `UNLICENSED`. The source archive is optional. There is no live folder edit; you need the source and a rebuild. |
| An update overwrites `worker.js` and `public/` and leaves SQLite alone. | `prove` | An update activates a new immutable version. The data stays, and migrations run on first use. |
| No email or push notifications. | `keep` | The Wichteln app has no mail binding, and sites have no outbound network by default. |
| One container, amd64 and arm64, with a Home Assistant add-on. | `keep` | The appliance and add-on are in the repo. |
| Hostile-app sandboxing is a goal. | `keep` | `docs/SECURITY.md` says this directly. |

## What the post now claims with evidence

- Idle apps can be shed and wake on request; one node hosts many sites.
- Each app instance runs in an isolate; each Durable Object has SQLite; each
  crumb is its own site with its own data.
- Install 230 ms, new crumb 65 ms, proxied request about 1.5 ms more than
  direct celld. Measured on the development VM (10 vCPU, 8 GB node limit),
  recorded 2026-11-01, `npm run e2e` in `hamstr/README.md`.
- No egress by default; a declared allowlist is required before the app's
  server can make a request.
- Sign-in is platform-level; apps do not need their own account code.
- Security limits: sites share one process, heap and disk; this is not a
  hostile-app sandbox; no per-app secrets; data is plaintext; no byte quotas;
  no WebSockets or alarms; no signing.
- celld is alpha. The node pins `0.6.3` in `node/Dockerfile`.

## What I did not verify

- I did not re-run the 230 ms / 65 ms benchmark or the full test suite. The
  numbers come from the repository's recorded run.
- I did not test the public store, because no public hostname resolved.
- I did not audit celld itself, V8, or the upstream security claims in the
  source conversation. The post's project claims follow the repository; the
  argument about small SaaS is my opinion.
