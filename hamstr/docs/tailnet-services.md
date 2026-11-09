# Tailscale Services for crumbs (prototype)

Gives each crumb its own tailnet name, `https://crumb-<id>.<tailnet>.ts.net`, with
Tailscale's certificate and no DNS or port setup. It does what
[DockTail](https://github.com/marvinvr/docktail) does for containers, with crumb
ids from `hamstr.db` as the input.

**Status:** wired into Hamstr (home mode) as Settings → Addresses → Tailscale
(`src/lib/server/tailnet.ts`). Verified on a real tailnet (2026-11-09, appliance,
tailscale v1.104.4): connect → shell on `https://<machine>.<tailnet>.ts.net`,
a crumb's service a few seconds after it is made, removed on trash, back on
restore, kept across a restart; Turn off removed the services and the machine.
The first request to a new name waits for its certificate (about 30-40 s).

### Built in (appliance)

The appliance runs `tailscaled --tun=userspace-networking` as its unprivileged
user (socket `/tmp/tailscaled.sock`, state `/data/tailscale`, log upload off),
logged out until an admin connects. Hamstr gets the socket as
`HAMSTR_TAILSCALE_SOCKET`; without it the option is shown as unavailable.
On Connect it checks the OAuth client's scopes (`auth_keys`, `services`), logs
the machine in with the client secret as a tagged, preauthorized auth key (from
a 0600 file, `--auth-key=file:`, never argv), serves the shell with
`tailscale serve --bg --https=443 http://127.0.0.1:<hamstr port>`, then
reconciles every 60 s and half a second after a crumb is made, trashed,
restored or deleted. The secret is stored in `hamstr.db` (like OIDC client
secrets) and never returned by the API. Defaults: machine tags
`tag:server,tag:container`, service tag `tag:container` (the OAuth client on
siren-macaroni refused `tag:server` alone).

The rest of this page describes the reconciler and the standalone
`tools/tailnet-sync.ts`, which still works for a tailscaled run elsewhere
(`HAMSTR_TAILNET_DOMAIN` / `HAMSTR_TAILNET_SHELL`).

## Pieces

- `lib/tailnet-services.ts`: `createTailnetServices(...).reconcile(crumbs, { dryRun })`.
  Per cycle: one `GET /tailnet/-/services`, `tailscale serve status --json`,
  `tailscale debug prefs`; then, in order: remove (drain, clear, DELETE the
  definition), define (`PUT` with `ports: ["tcp:443"]`, only when missing or
  tags/comment differ), serve (`serve --service=svc:crumb-<id> --https=443 <upstream>`),
  advertise. It does nothing if it cannot read the current state.
  **What it may remove:** only `svc:crumb-<12 chars>` names this machine serves or
  advertises (drain + clear), and it deletes the tailnet-wide *definition* only
  when its comment carries this Hamstr's mark (`TAILNET_INSTANCE=<id>` writes
  `hamstr:<id>` into every definition it creates). Without `TAILNET_INSTANCE` it
  never deletes a definition. It refuses to remove more than
  `TAILNET_MAX_REMOVALS` (default 20) services in one cycle, so an empty or wrong
  crumb list cannot wipe the tailnet. Two Hamstrs in one tailnet need different ids.
  Proxy targets are compared as URLs (a trailing slash is not a change).
  **Anyone your ACL lets reach `tag:container` can open every crumb**: home mode has
  no sign-in, so tailnet access is the access control.
- `tools/tailnet-sync.ts`: one reconcile from the live (non-trashed) crumbs;
  `--dry-run` prints the plan and changes nothing.
  `node tools/tailnet-sync.ts --dry-run --db /data/hamstr.db`
- `HAMSTR_TAILNET_DOMAIN=siren-macaroni.ts.net` (home mode only): the
  main listener also answers `crumb-<id>.<that domain>`, with `https` as the
  crumb's origin for the cross-origin checks.

## Setup (yours, in the admin console)

1. Policy: `tagOwners` `tag:server` (admins) and `tag:container` (owned by
   `tag:server`); `autoApprovers.services` `tag:container` approved for `tag:server`.
2. A tagged node to host the services: a sidecar (`tailscale/tailscale` with
   `TS_USERSPACE=true`, `--advertise-tags=tag:server`) or a tagged host. The
   existing `homelab` host is not tagged and has its own `tailscale serve`.
3. An OAuth client: Services Write (tag:container), Devices Core Write. Give it
   to the tool as `TAILSCALE_OAUTH_CLIENT_ID` / `TAILSCALE_OAUTH_CLIENT_SECRET`
   (or the `_FILE` variants). Never log or commit them.

## Open questions, verify live

1. **Host header.** Does `tailscale serve` forward the browser's
   `crumb-<id>.<tailnet>.ts.net` Host to the upstream, or rewrite it? The server
   already accepts that name (test: `home-names.test.ts`), but the upstream
   must be Hamstr's listener (`TAILNET_UPSTREAM`, default `http://127.0.0.1:8000`).
   With the sidecar in userspace mode it must reach the host, so the upstream
   cannot be loopback of the host: use an address the sidecar can reach.
2. **Does `serve status --json` report the proxy as `http://127.0.0.1:8000`?** The
   reconciler compares it to the upstream; DockTail's own fixtures disagree about
   the key format (`svc:x:443` vs `https://svc:x:443`). A mismatch means it
   re-serves every cycle (harmless but noisy).
3. **Limit.** The 10-Services-per-user figure from Tailscale's GA post did not apply:
   200 DockTail-created Services worked on this tailnet (2026-11-08). Re-check
   before relying on it; there may be a higher limit or plan dependency.
4. **Scale.** One list call per cycle; each missing crumb is 3 CLI calls. Rate
   limits (429) are tolerated per service and retried next cycle, not backed off.
5. **Who runs it.** Needs access to the tailscaled socket and OAuth secrets,
   so run it in the sidecar's network namespace/volume, not inside Hamstr.
6. **HTTPS vs the shell.** Tailscale terminates TLS; Hamstr sees plain HTTP. If
   the shell is HTTP-only, a crumb on `https://` inside an `http://` shell iframe is
   fine, the reverse (https shell, http crumb) is blocked as mixed content.
