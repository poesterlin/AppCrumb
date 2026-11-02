# Hamstr manual

The user-facing documentation for Hamstr, built with [VitePress](https://vitepress.dev). It is a normal Markdown site
plus one dynamic page: the [compose generator](https://github.com/poesterlin/AppCrumb/tree/main/docs-site/install/generator.md),
which writes a `compose.yaml` and `.env` for the user's setup in the browser.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in .vitepress/dist
npm run preview    # serve the build locally
npm test           # the generator's tests
```

`npm test` also runs `docker compose config` on every generated scenario. Those cases are skipped when Docker is not
available.

## Layout

| Path | What |
| --- | --- |
| `index.md` | The landing page |
| `guide/`, `install/`, `configure/`, `using/`, `help/`, `reference/` | The manual |
| `.vitepress/config.ts` | Navigation, sidebar, search, theme text |
| `.vitepress/theme/` | The Hamstr palette and the generator component |
| `.vitepress/theme/lib/compose.ts` | The generator: options, validation, YAML, `.env`, `docker run` |
| `.vitepress/theme/lib/compose.test.ts` | Tests, including `docker compose config` |
| `hamstr.json` | The store manifest: this manual is published as the app `lab/manual` |
| `celld.json` | Packs the VitePress build (`.vitepress/dist`) as a celld site |
| `public/` | Logo and feature icons |

## The generator

The Vue component only collects options; all the logic is in `lib/compose.ts`, which is a pure module. That keeps it
testable and makes it easy to extend:

- **A new scenario** — add it to `SCENARIOS`, handle it in `generate()` and the component's `pick()`.
- **A new DNS provider** — add an entry to `DNS_PROVIDERS` with lego's variable names (check `lego dnshelp`), and a row
  in `install/https.md`.
- **A new setting** — add it to `Options` and `defaultOptions()`, emit it in `generate()`, and add an input.

To point the manual at a publicly hosted names service, copy `.env.example` to `.env` and set
`VITE_NAMES_SERVICE_URL=https://names.example.com` before building. The value prefills the names-service field;
the field stays editable.

Rules the tests enforce:

- secrets never appear in `compose.yaml` — only `${VAR}` references and an empty entry in `.env`;
- every scenario passes `docker compose config`;
- the `docker run` command mirrors the compose file;
- the container name is also the Compose project name, so it is lowercase.

Please keep those invariants when editing.

The generator page is deliberately calm and dyslexia-friendly: one column, plain words, Atkinson Hyperlegible at
17px, short helper lines, and every optional setting behind **More settings**. Keep that shape when adding a field,
and prefer a clear sentence over a jargon label.

## Deploying the manual

The public manual is **[docs.appcrumb.store](https://docs.appcrumb.store)**: a plain celld site on the AppCrumb host
(tunnel → Traefik → celld). The build is static files; `celld.json` points the packer at `.vitepress/dist`.

```sh
npm run build
cd ..
bundle=$(mktemp -d)
node tools/pack.ts docs-site "$bundle"
tar -C "$bundle" -cf - . | ssh public-vm \
  'docker compose -f /opt/stacks/celld-sites/compose.yaml \
    -f /opt/stacks/celld-sites/compose.w3.yaml \
    -f /opt/stacks/celld-sites/compose.local-image.yaml \
    exec -T celld /app/push.sh docs.appcrumb.store'
rm -rf "$bundle"
```

The hostname must match the node's `SITES_RULE`. The deploy check requests `/`.

## Publishing to the store

`hamstr.json` makes the same build installable as a Hamstr app (`instances: "single"`, no egress, no permissions), so
people can also **Get** the manual inside Hamstr:

```sh
node store/cli/hamstr.ts publish docs-site --store https://appcrumb.store
```

Bump `version` in `hamstr.json` for every release; a published version can never be replaced.

## Writing style

- Lead with what the reader has to do, then why.
- Every command should be copy-pasteable and complete.
- Say what does not work, and what is not tested. This project is alpha; the manual should not pretend otherwise.
- Link to the repository's source documents rather than duplicating long explanations that will drift.
