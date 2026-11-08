# Home mode (no sign-in)

Home mode is the smallest Hamstr: no accounts, no certificate, no proxy. It is what the Home Assistant add-on starts
with, and what the [generator](/install/generator) produces when you pick *Home network*.

```yaml
environment:
  - HAMSTR_AUTH=none
  - HAMSTR_CRUMB_PORTS=20000-20999
ports:
  - "8000:8000"
  - "20000-20999:20000-20999"
```

Open `http://<box>:8000`.

## What you get

- **No sign-in.** Every visitor is the owner. Anyone on your network — guests included — can read, change and delete
  everything.
- **Plain HTTP.** No certificate, no domain, no DNS provider.
- **A port per crumb.** There are no crumb hostnames. When a crumb is first opened, Hamstr gives it a port from
  `HAMSTR_CRUMB_PORTS`, and Caddy starts listening on it. A separate port is a separate origin, so crumbs stay
  isolated from each other and from the shell.

## Names instead of ports (optional)

Pick it in *Settings → Addresses* (it has a Test button), or start with `HAMSTR_HOME_NAMES=sslip.io` (or `nip.io`) as the default. Each crumb opens at
`http://crumb-<id>.192-168-1-5.sslip.io:8000` instead of on its own port. Those services answer DNS queries for
such names with the address inside them, so there is nothing to set up, only one port to publish, and each crumb is
still an origin of its own.

- Open Hamstr by the box's IP address, or set `HAMSTR_HOME_ADDRESS` (IPv4) when you use a name such as
  `homeassistant.local`. Without an address it falls back to ports.
- It needs working internet DNS and a third party's name service.
- Some routers refuse public names that resolve to private addresses (DNS rebinding protection). Then the names fail
  and you should keep ports or allow the domain in the router.

## What does not work

Browsers only grant some features on secure origins:

- passkeys and WebAuthn;
- the clipboard API;
- camera and microphone;
- installing an app to the home screen;
- some service workers.

Browsers also share cookies across ports on one host, so port isolation is origin isolation but not cookie isolation.
Apps get identity from Hamstr's headers, not cookies.

## Publishing the ports

There are two ways:

**Map the range.** The generator publishes `8000` and `20000-20999`. Docker sets up a thousand forwards; it works, but
the container has no host network and the ports are fixed at start.

**Share the host's network.** `network_mode: host` is what the Home Assistant add-on does. Hamstr then listens on the
box's own interfaces and crumbs open their ports directly. Other containers share those ports, so check for conflicts.

The appliance's ports are in the [ports reference](/reference/ports).

## Turning sign-in on later

Home mode is a setting, not a separate edition:

1. Set `HAMSTR_AUTH=required`.
2. Pick a TLS mode (`domain` or `names`) and configure it — see [HTTPS](/install/https).
3. Register an OIDC client and set `OIDC_*`.
4. Restart the container.

Existing crumbs keep their data. Their addresses change from `http://box:<port>` to
`https://crumb-<id>.<domain>`, so bookmarks change.

::: warning Be honest about the network
Home mode is fine for a box on a trusted LAN or behind a VPN. Do not expose it to the internet: there is no
authentication at all.
:::

## When to use it

- Trying Hamstr before deciding on a domain and a sign-in provider.
- A family box on a trusted network, where the alternative is "no tool at all".
- A demo or a workshop.

For anything with more than one person's private data, use sign-in.
