# Apps and the store

Hamstr ships with no apps. They come from **[AppCrumb](https://appcrumb.store)**, the public catalog. Most installs use that and never run a store themselves.

## Point at a store

Fresh installs seed **Settings → Stores** with `https://appcrumb.store`. Admins can register other URLs there; only one is **active** at a time (browse, Get, and updates use that catalog).

```yaml
environment:
  - HAMSTR_STORE=https://appcrumb.store
```

- `HAMSTR_STORE` / `HAMSTR_STORE_PUBLIC` seed the first entry on a fresh install (default `https://appcrumb.store`). After that, Settings owns the list.
- Empty Settings list and no seed means no store: the store page explains that none is configured, and nothing can be installed.
- `HAMSTR_STORE_PUBLIC` is the seed’s public/link URL (defaults to `HAMSTR_STORE`).
- The Home Assistant add-on uses the same default; change catalogs under Settings → Stores.

A store only serves metadata and bundles. It never runs app code, and it never sees the data in your crumbs.

## Install an app

1. Open **Store** in Hamstr and find an app.
2. Read what it does and what it asks for. The only capability an app can request is internet access, and the
   installer shows it.
3. Press **Get**.

An admin's **Get** installs the app for everyone: it appears on every home screen. A non-admin cannot install for the
whole install.

Installing:

- downloads the release and checks its SHA-256 and the contents of every file;
- uploads the code to celld once;
- boots it on a throwaway probe site before anyone can use it.

## Moderation is not a sandbox

The official public store checks every release and, with review on, a person approves it before it is listed. It can
take releases down and suspend publishers. That is real risk reduction, and it is why the official store is a better
default than an unknown one.

It is not a containment boundary. Moderation happens before install; it does not limit what an app can do afterwards,
and it cannot prove an app is safe. The runtime does not yet claim to sandbox hostile apps either. Treat the store's
review as one input, not a guarantee, and run apps you trust.

## Try before installing

A store can offer **Try it live**, which runs a disposable copy on the store's own demo node. That copy has its own
bucket, state and token; it cannot reach your install. The demo is thrown away after a few minutes.

## Updates

An app's release is immutable. When the publisher ships a new version and you update it:

- every crumb moves to the new version;
- crumb data stays;
- the app's migrations run on first use.

An app cannot be updated to a version older than the one that made a backup you are restoring. Update first, then
restore.

## Internet access

Apps have no network access by default. `fetch()` throws. If an app declares egress, an admin can allow specific
hostnames; only `https:` on port 443, no IP literals, no redirects out of the allowlist.

Changing the allowlist clears the app's cache and aborts its running objects, so a long-lived object cannot keep using
the old list.

## Running your own store (uncommon)

You do not need this for a personal Hamstr. Publishers use [appcrumb.store](https://appcrumb.store); Hamstr only
downloads from a catalog. Running a store is for people who operate a catalog (or develop this project).

A store holds publisher accounts, apps and releases, and moderation. The compose stack in this repository can run one:

```sh
COMPOSE_PROFILES=store
```

It is LAN-only by default. Making it public needs a tunnel entry, `STORE_REQUIRE_REVIEW=1`, and brings legal
obligations where you host it. See the repository's
[store README](https://github.com/poesterlin/AppCrumb/tree/main/store), especially "Going public" and
"Moderation".

A self-hosted store with review off is not covered by AppCrumb's moderation. Neither setting makes an app safe to run.

Do not confuse the two roles:

| | Personal Hamstr | AppCrumb |
| --- | --- | --- |
| Runs app code | yes | no |
| Holds crumb data | yes | no |
| Needs an account | for its people | for publishers only |
| Usual role | get apps | the public catalog at appcrumb.store |

## What is out of scope

The store has no payments, ratings, comments, screenshots or verified publisher identity, and it does not build
publishers' code. Those are deliberate: building untrusted code on the store host would be remote code execution.
