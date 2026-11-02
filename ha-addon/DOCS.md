# Hamstr

Install little web apps in one click.
Your data stays on this Home Assistant box.

> Work in progress. Expect changes.

The full manual is at
[docs.appcrumb.store](https://docs.appcrumb.store), including
[Home Assistant setup](https://docs.appcrumb.store/install/home-assistant.html).

## Start

1. Start the add-on.
2. Click **Hamstr** in the sidebar.

That's it. You are the owner.

The sidebar tries to show Hamstr inside the panel when the browser allows it
(Home Assistant and Hamstr on the same scheme — often both plain HTTP). If that
is blocked (typical when Home Assistant is HTTPS and Hamstr is HTTP), use
**Open Hamstr** to open it in its own tab on this box's address, for example
`http://homeassistant.local:8000`.

## Get apps

Apps come from [AppCrumb](https://appcrumb.store). Fresh installs use that
catalog automatically. To point at another store, open Hamstr → **Settings →
Stores** (no add-on restart).

## Home mode

The add-on starts in home mode (`auth: none`):

- There is no sign-in. **Anyone who can reach this box is the owner.**
  That includes guests on your Wi-Fi.
- It uses plain HTTP. Browsers show "Not secure".
- Some app features need HTTPS and do not work: passkeys, the clipboard,
  the camera and microphone, and installing apps to the home screen.
- Each item you make gets its own port, from 20000 up.

Use home mode on a network you trust.

## Sign-in and HTTPS

For sign-in and HTTPS, set `auth: required` and a `tls_mode`:

| `tls_mode` | What you need |
| --- | --- |
| `domain` | Your own domain at a DNS provider with an API. Set `domain`, `dns_provider`, and the provider's token in `env` (for example `CF_DNS_API_TOKEN=...`). Point `domain` and `*.domain` at this box. |
| `names` | A Hamstr names service: `name_service_url`. |

You also need a sign-in provider (OIDC) with an HTTPS address: set the
`oidc_*` options. Its redirect address is
`https://<domain>/auth/callback/<oidc_name in lowercase>`.

HTTPS is on port 8443, HTTP on port 8000.

## Data

Everything is in the add-on's data folder, including generated secrets.
Home Assistant backups include it.
