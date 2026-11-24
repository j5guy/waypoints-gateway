---
space: administration
path: gateway-architecture
title: "Gateway: architecture"
summary: "How the Waypoints Gateway is built: the web UI, the Docker CLI, the Caddyfile and the catalog."
---

# Gateway: architecture

## Shape

A dependency-free Node 24 HTTP server (`server.js`, `lib/*`) with a vanilla JavaScript single page (`public/`). The image also contains the Docker CLI and Compose plugin, copied from `docker:27-cli`, and drives the **host's** Docker through the mounted `/var/run/docker.sock`. There is no `package-lock.json` because there are no npm dependencies.

## Files

| Path | Role |
|---|---|
| `server.js` | Routes, cookie session, same-origin check, static files |
| `lib/auth.js` | Administrator password (scrypt), first-visit claim window, sessions, lockout |
| `lib/manage.js` | One app's page: info, start/stop/restart (`docker compose`), logs, plain-language checks, settings apply |
| `reset-password.js` | Deletes `auth.json` so a new password can be created |
| `lib/detect.js` | Docker and Compose check, port 80/443 probe, existing proxy detection |
| `lib/installer.js` | Input validation, background install job, app status |
| `lib/caddy.js` | Builds and writes the Caddyfile, reloads Caddy, finds the CA root file |
| `lib/snippets.js` | Reverse proxy configs for nginx, Apache, Traefik, Caddy, Nginx Proxy Manager |
| `lib/state.js` | `state.json` in the data volume; secrets in it are encrypted on disk |
| `lib/secrets.js` | AES-256-GCM encryption of saved secrets, the key volume, and `composeSecrets` (secrets passed to Compose from memory) |
| `lib/catalog.js` | Loads `catalog/<id>/app.json` |
| `catalog/<id>/` | `app.json`, `compose.yml` (joins the proxy network, no published ports), `own-proxy.yml` (publishes one port) |
| `caddy/compose.yml` | The built-in proxy container |

## Data and volumes

| Volume | Contents |
|---|---|
| `waypoints-gateway-data` | `/data/auth.json` (password hash), `/data/state.json`, `/data/caddy/Caddyfile` (shared read-only with Caddy at `/gateway`) |
| `waypoints-caddy-data` | Caddy's certificates and local CA. The gateway mounts it read-only at `/caddy-data` to offer `pki/authorities/local/root.crt` for download |

`state.json` holds: `mode` (`builtin` or `own`), `access` (`lan`, `domain` or `own`), `baseName`, `acmeEmail`, `bindAddr`, `apps` (`id` to `host`, `port`, `env`), `configured`. It never holds passwords.

## Network

One external Docker network, `waypoints-proxy`, created by the gateway. In built-in mode Caddy and every app's `app` service join it, so Caddy reaches `fondwaypoints-app:5560`. Databases stay on each project's own default network.

## Install flow

`POST /api/setup` validates, creates a job and returns `202`. `installer.apply` then: creates the network, writes state, (built-in) writes the Caddyfile and runs `docker compose -p waypoints-caddy up -d` then `caddy reload`, (own proxy) removes the Caddy container, then runs `docker compose -p waypoints-<id> -f compose.yml [-f own-proxy.yml] up -d` per app, passing `WEB_FQDN`, `BIND_ADDR`, `HOST_PORT` and the app's fields as environment. The page polls `GET /api/job/<id>`. Jobs are in memory (last 20).

## Versioning, release notes and What's new

Every change bumps `package.json`, adds a heading at the top of `RELEASE_NOTES` (developer-facing, the source of truth), adds an entry at the top of `lib/whatsNew.js` (plain language, shown to users) and updates the docs, including `docs/site/whats-new.md` and the docs in the same change. `scripts/check.sh` (run by `prod.yml` and `test.yml`) fails unless `package.json`, the newest `RELEASE_NOTES` heading and the newest `lib/whatsNew.js` entry name the same version.

`GET /whats-new` serves `public/whats-new.html` (no sign-in); it loads `GET /api/whats-new` (`{ version, releases }`). `GET /api/site` (`{ version, xUrl, docsUrl }`, also public) feeds the footer built by `public/footer.js` on every page: version, What's new, Docs, and Follow us on X. `xUrl` comes from `lib/community.js` (default `https://x.com/allthewaypoints`; the `X_URL` environment variable overrides it, and an empty value hides the link). The docs link points at the `gateway-waypoints` docs space.

## Storage

Each catalog entry lists `storage`: `{ env, volume, label, help }`. The compose files mount `${<ENV>:-<volume>}:<path>`, so by default each location is a Docker volume named `waypoints-<id>_<volume>`, and a `state.apps.<id>.storage[ENV]` folder path (passed to Compose by `installer.composeEnv`) switches that one location to a bind mount. `manage.checkStorage` (`POST /api/app/<id>/storage-check`) runs the checks without stopping anything and returns `{ ok, checks: [{ ok, level (ok, info, warn, error), label, fix }], sizeKb, availKb }`; only `error` blocks. It validates the folder (`cleanFolder`: absolute, a conservative character set, no `..`, not a system folder), refuses overlap with any other storage folder of any app (equal, parent or child), and probes the source and destination from one `docker:27-cli` helper (`du`, writable, empty, `df` free space, `stat -f` file system type): not writable is an error; non-empty is an error unless "already holds my data" is set (then empty is the error); free space below size x 1.1 is an error and below x 1.5 a warning; a network file system (`nfs`, `cifs`, `smb`, `sshfs`...) is a warning for the Database (`mongo-data`). `manage.moveStorage` runs `checkStorage` first as its first job step, before stopping the app, then stops the app, copies with `cp -a` (nothing is copied when the folder already holds the data), verifies the copy (same `find . | wc -l` on both sides, otherwise the old place is kept and the app restarted), saves the new place, starts the app and waits for it (`waitRunning`: running and healthy within 120 s; an app without a health check must stay up 8 s). If it does not come up the previous storage setting is restored and the app restarted. The old copy is always kept. Wiping an app with `down -v` deletes only Docker volumes; folders are left and named in the job. Backups read from the folder when one is set.

## Shared settings

`lib/shared.js` defines the groups (email, ldap, sso, backups, general) with their fields, and `MAP`, which says which of each app's own variables a shared field becomes (a plain name, or `{ env, map }` to translate a value, as for Loadout's `AUTH_MODE`). `state.shared[group]` = `{ values, apps: 'all' | [ids] }`. `manage.saveShared` validates, saves, applies the values to the chosen installed apps' `settings` (`shared.applyValues`, which treats the Shared page as the source of truth for those apps: an empty field is removed), rewrites their overrides and restarts only the apps whose settings changed. `installer.apply` calls `shared.seedNew` for an app installed for the first time, and keeps `state.shared` when setup is run again. `GET /api/shared` returns each group with its values (secrets only as set or not), the apps that use it and how many fields each covers.

## Bringing in an existing install

`lib/adopt.js`. `scan` (`GET /api/adoptable`, also run when the page opens and by the home page's "Look for apps installed outside the Gateway" link) returns `{ apps, notes }`: `apps` are the apps that can be brought in (a database container was found), `notes` are plain-language reasons for look-alikes that cannot (the app without its MongoDB container, or something named `<id>waypoints` that is not running from the published image); `detect` returns just `apps`. `scan` finds containers whose image repository is a catalog app's `image` and whose Compose project is not `waypoints-<id>`, with the database found as the `mongo` service of the same project. `adopt` (`POST /api/adopt`): optional backup first (`uninstall.backup` with `{ dbContainer, sources }` read from the old containers' mounts), then stop and rename the old containers `<name>-before-gateway-<date>` with their restart policy off, write state and the override, copy every data location into `waypoints-<id>_<volume>` volumes, start the project and update the proxy. Settings are imported from the old container's environment: the listed settings and sign-up fields, plus every other variable that is not baked into the image and not managed by the Gateway as "anything else" rows (this keeps a custom `mongoDBName`, LDAP settings and hand-set secrets). Refused when the old install uses its own database server or a login. Any failure renames the old containers back and starts them again.

## The encrypted setup address, your own certificate, hardware and install-time settings

**Setup address** (`lib/tls.js`, `server.js`): the same request handler is served on `http` (`PORT`, 8080) and on `https` (`HTTPS_PORT`, 8443; `0` turns it off). The certificate is generated with `openssl req -x509` (the image installs `openssl`) the first time and kept beside `master.key` (the key volume when mounted, else the data volume), with the list of names it was made for in `gateway-tls.san`. It names `localhost`, `waypoints-gateway`, `127.0.0.1` and `GATEWAY_IP` (an IPv4 address only; anything else is ignored), and is remade when that list changes or it has under 30 days left. If the certificate cannot be made the HTTPS listener is skipped and the plain one keeps working. `sessionCookie` adds `Secure` when `req.socket.encrypted` or `x-forwarded-proto` is https. `install.sh` detects the computer's address, writes `GATEWAY_IP` to `.env` and prints the https address first.

**Own certificate** (`lib/certs.js`): `inspect` uses `crypto.X509Certificate` and `createPrivateKey` to check that the text is a certificate and a key, that `checkPrivateKey` matches, the key has no passphrase, the dates (error when expired or not yet valid, warning under 30 days), warnings for self-signed or a single certificate with no chain, and `checkHost` for every address that must be covered (wildcards cover one label). `installer.validate` runs it when `certSource: 'custom'` (a domain install) against the Gateway's own host and every app host, using the saved files when none are sent; `apply` saves `/data/certs/custom.pem` and `custom.key` (mode 0600), stores only `customCertInfo` (names, expiry, subject) in state, and removes the files when the choice goes back to Let's Encrypt or a home network. `caddy.build` writes `tls /gateway/certs/custom.pem /gateway/certs/custom.key` for each site (and no ACME email) when `state.customCert` and the access is `domain`. `POST /api/cert-check` checks pasted or saved files for the page; `POST /api/certificate` replaces the saved certificate after the same checks against the current hosts and reloads Caddy. The files are not encrypted at rest like saved secrets because the proxy reads them.

**Hardware** (`lib/hardware.js`): on `arm64` a CPU `Features` line without `fphp`, `asimdhp` or `asimddp` (no ARMv8.2-A), or a device-tree model of Raspberry Pi Zero/1 to 4 when the line is unreadable, selects the older MongoDB; on `x64` a `flags` line without `avx` does; `arm` (32-bit) is `unsupported`. Unreadable CPU information on x64 changes nothing. `installer.seedNewApp` sets `MONGO_IMAGE=mongo:4.4.18` for a newly installed app that has none (never for an existing app, whose data may already be in the newer format), `apply` stops on `unsupported`, and `GET /api/detect` and `/api/state` return the result for the Check step and the install step. `adopt` keeps the old install's database image (`oldDb.Config.Image`) when it is not `mongo:7`.

**Install-time settings** (`lib/settingsutil.js`, `public/app.js`): `validateSetting` and `applyListed` are shared by the settings page (`manage.applySettings`) and `installer.validate`. For an app not yet installed, the payload may carry `settings`, `extra` and `useShared`; `validate` checks them like the settings page and `seedNewApp` applies the ticked groups (`shared.applyValues`) and makes the app part of each (`state.shared[g].apps`); with no `useShared` it falls back to `shared.seedNew`. The page's `settingsEditor(a, i, opts)` is the same form on the app's page and in the install step (`installSettings`); `shared.envGroups()` says which settings each group manages, so they are hidden while the group is ticked at install and marked "Also set by Shared settings" on the page. `catalog/<id>/app.json` `insideApp` lists what cannot be set from the Gateway and is shown in both places.

## Publishing the repository

The source of truth is the private Gitea repository; the public copy is `github.com/j5guy/waypoints-gateway`. Nothing is published from a developer machine except the very first push, by hand. `.githooks/pre-commit` (turn on with `git config core.hooksPath .githooks`) refuses a commit with the wrong identity (`dev@allthewaypoints.com`), a blocked file type (`.githooks/blocked-paths.regex`), a secret (`gitleaks protect`, configured by `.gitleaks.toml`) or a string from the private denylist (`PUBLISH_DENYLIST_FILE`, default `~/.publish-denylist`). `.githooks/pre-push` runs `scripts/publish-gate.sh`, which checks the whole history: commit identities (author and committer, all refs), `gitleaks detect` over every commit, the denylist in the tree, in every diff and in every commit message and name (messages are scanned on their own so a commit that changes no file cannot hide one), blocked file types ever committed, and refs (only `master`, `test`, remotes and tags may exist). It refuses to pass without a non-empty denylist.

`.gitea/workflows/prod.yml` runs the gate before anything is built or pushed, builds and pushes the image to GHCR, then pushes `master` and tags to GitHub with no `--force` (a plain push fails if the histories differ), clones what GitHub now holds and runs the gate on that, and finally creates a GitHub release for the version if there is none. Secrets: `REMOTE_REPO_TOKEN` (fine-grained token, this repository only, Contents and Releases write; a secret name cannot start with `GITHUB_`), `PUBLISH_DENYLIST`, plus the GHCR and Gitea ones. The runner needs `gitleaks`. The test workflow never touches GitHub. `scripts/publish-gate.sh` is the same script as in the other repos; keep them identical (the commit-message scan above is an addition to the runbook's original).

## Removing the Gateway (uninstall.sh)

`uninstall.sh` is a standalone script (not part of the image). It finds what the Gateway made without needing the Gateway to be running: the `waypoints-gateway` and `waypoints-caddy` containers by name, the apps as every container whose `com.docker.compose.project` label starts with `waypoints-` (so the `...-before-gateway-...` containers kept by an adoption, which keep their original project, are never matched), and the volumes `waypoints-gateway-data`, `waypoints-gateway-key`, `waypoints-caddy-data` and `waypoints-<app>_*`. Levels: default (Gateway and proxy), `--apps` (plus app containers), `--data` (plus every matching volume, the Gateway folder, and a first step that copies `/data/exports` out through a `docker:27-cli` helper and stops the whole run if that fails). `waypoints-proxy` is removed only when nothing still uses it. It prints the plan and asks before acting, `--data` also needs `delete my data` typed, `--dry-run` only prints, and `--yes` skips questions. `scripts/check.sh` syntax-checks it. It was tested with a pretend `docker` that records calls (27 checks); it has not been run against a real Docker.

## Uninstall and backups

`POST /api/app/<id>/uninstall` (`keepData` default true, `backup`, `confirm`) starts `uninstall.uninstall` as a job. Optional backup first (`uninstall.backup`): `docker exec <db container> mongodump --archive --gzip` written to a staging folder by `runToFile`, then every volume labelled `com.docker.compose.project=waypoints-<id>` except `mongo-data` is tarred by a `docker:27-cli` helper (`docker run --rm`, the volume read-only at `/in`, the gateway data volume at `/out`), a README is added, and everything is packed into `/data/exports/<id>-<YYYYMMDD-HHMMSS>.tar.gz` (mode 0600). Any failure aborts before anything is removed. Then `docker compose -p waypoints-<id> ... down` (keep data) or `down -v` (delete; the app name must be typed and is verified server side). The app leaves `state.apps`, its override file is deleted, and in built-in mode the Caddyfile is rewritten and reloaded. Because the project name is stable, reinstalling after a keep-data uninstall reattaches the named volumes. Images are not removed. File names are validated against `^[a-z0-9-]+-\d{8}-\d{6}\.tar\.gz$` before any path is built.

## Appearance and icons

**Appearance** (`lib/appearance.js`): `state.appearance` = `{ mode (system, light, dark), light and dark (text, textSecondary, bg, accent, menuText, menuBg as #rrggbb), font (system, serif, mono, rounded), size (small, normal, large), density (comfortable, compact), motion }`, validated by `appearance.validate` and saved by `POST /api/appearance`. It is public (it is returned by `GET /api/site`) so the sign-in and What's new pages can use it; it holds no secrets. `public/theme.js` is loaded in the `<head>` of every page: it applies the cached appearance at once (`localStorage` key `gw.appearance`), then the saved one, by setting CSS variables on `:root` (`--text`, `--muted`, `--bg`, `--accent`, `--accent-text`, `--menu-text`, `--menu-bg`, `--font`, `--pad`, `--gap`), `data-theme` (forced dark or light) and `data-motion`, and `font-size` for the text size. `style.css` reads those variables; with `mode: 'system'` the `prefers-color-scheme` rules apply and `theme.js` re-applies when the device changes.

**Icons** (`lib/icons.js`): stock icons are `public/icons/<id>.svg` (copied from the apps' own icon files). A custom icon is `/data/icons/<id>.<ext>`, uploaded as a raw image body to `POST /api/app-icon/<id>` (limit 512 KB, content type must be `image/*`, the request must come from the same origin). The type is taken from the first bytes (PNG, JPEG, WebP, GIF, SVG), not from the browser; an SVG containing `<script>`, `<foreignObject>`, event handlers, `javascript:` or entities is refused. `GET /icons/<id>` needs a signed-in session and is served with `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; sandbox` and `Cache-Control: no-cache`. `POST /api/app-icon/<id>/reset` deletes the custom file. The page asks for `/icons/<id>?v=<n>` and falls back to a colored letter if it cannot load.

## Page structure

Sections on every page are listed A to Z (`byLabel` in `public/app.js`), except where order carries meaning: the app's status, controls and update line stay at the top of its page, its Uninstall section is always last, and the home page lists installed apps first, then the others, each A to Z. Folded sections are `<details>`: `section(title, note, ...children)` for whole cards (the Settings page, Shared settings groups) and `details.subgroup` for the groups inside an app's Settings. App card colors are `state.appearance.cards[appId]` (set from an app's page, saved with the rest of the appearance); a tile with one gets the `tinted` class and a `--tile-color` variable.

## Navigation

`index.html` has a header `nav` (Home, Certificates, Updates, Settings), shown only once setup is finished. `public/app.js` renders each page with `dashboardView`, `certsView`, `updatesView` and `settingsView`; `setNav` marks the current page and the Updates item carries a count badge set by `checkUpdates`, which runs on the home page and the Updates page. The home page shows the app tiles first and a one-line strip (update summary, certificate link on a home-network setup).

## Home page

The tiles are flex columns in a grid that stretches every tile in a row to the same height. The top of a tile (icon, name, description limited to three lines) has `flex: 1`, so the status line and the buttons are pushed to the bottom and line up across the row. The icon is `appIcon` (the stock or custom image, with a colored-letter fallback).

`dashboardView` in `public/app.js` renders every catalog app as a tile in a CSS grid: installed apps (in `state.apps`) first, as full-color tiles, then the rest as grayed `.tile.off` tiles. A whole tile is clickable and keyboard-focusable (`role="link"`, Enter or Space); its Open link and Update button stop propagation. Clicking an installed tile calls `appView(id)`; clicking a grayed one calls `beginWizard(true, id)`, which ticks that app. The update badges come from `GET /api/updates` (`checkUpdates` fills `upEls`); the app page runs the same call for its own badge.

## Adding apps and re-running setup

The wizard (`beginWizard(addOnly)`) marks catalog apps present in `state.apps` as installed: not tickable, and always included in the payload so they stay in `state.json` and the Caddyfile. **Add an app** (`addOnly`) skips the Check and Address steps and reuses the saved mode and address. In `installer.apply`, an installed app is skipped (no `up -d`, so `pull_policy: always` cannot update it) unless its mode, bind address, host, port or environment changed.

## Per-app management

`catalog/<id>/app.json` lists `settings`: `{ level (basic or advanced), group, env, label, type (text, number, email, bool, secret, choice), default, help, options (choice), target }`. Values are saved in `state.apps.<id>.settings` and written to the Compose override, so `compose.yml` needs no edit to support a setting; `target: "compose"` (the database image) is read by Compose itself and is kept in `state.apps.<id>.env` instead. `POST /api/app/<id>/settings` takes `{ values, extra }` (listed settings and the Advanced "anything else" rows together), validates, saves, rewrites the override and runs `docker compose up -d` (a job the page polls). An empty value, or one equal to its default, is removed rather than saved; a secret is only replaced when typed (`null` keeps it, `''` clears it). The app page draws basic settings first, then a collapsed Advanced section with a warning. Other routes: `GET /api/app/<id>/info|logs|checks`, `POST /api/app/<id>/action` (`start`, `stop`, `restart`, run as the whole compose project). Checks are `{ ok, label, fix }`: container state and health, the database container (`<container>` with `-app` replaced by `-mongo`), the Caddy container (built-in mode), and an HTTPS probe of the app's address. Re-running setup merges, never replaces, saved settings.

The Advanced section's free-form rows are saved as `state.apps.<id>.extra` (`env`: list of name and value, `tag`, `memory`) in the same `POST /api/app/<id>/settings` call. `lib/compose.js` validates them (names `[A-Za-z_][A-Za-z0-9_]*`, `PORT` refused, tag charset, memory like `512m`) and `writeOverride(id, appState)` writes `/data/overrides/<id>.yml` from `settings` plus `extra`: `image: <catalog image>:<tag>`, `mem_limit`, and `environment` with every value as a double-quoted string and `$` doubled so Compose does not interpolate it. A free-form row wins over a listed setting of the same name. `compose.files()` adds that file as the last `-f` for install, update, start/stop/restart and settings, so it wins over `compose.yml`. A pinned tag makes `updates.check` report `pinned` for that app and the automatic updater skips it. Clearing everything deletes the file. In built-in mode the gateway also gets a Caddy site `gateway.<baseName>`.

## Updates

- **Detecting:** `lib/updates.js` compares the digest of the local `<image>:latest` (from `docker image inspect`, `RepoDigests`) with the registry's current digest for `latest` (an anonymous pull token from `ghcr.io/token`, then a `HEAD` on the manifest and `Docker-Content-Digest`). Each catalog app declares its `image` in `app.json`; the gateway's own image is `ghcr.io/j5guy/waypoints-gateway`. A result is `yes`, `no` or `unknown` (offline, or the image was not pulled from the registry). Needs the GHCR packages to be public.
- **Applying:** `POST /api/update` runs `installer.updateApps`: for built-in mode `docker compose pull` and `up -d` for the Caddy project, then for each app `pull` (nothing changes if it fails) and `up -d` with the saved state's environment. Data is in named volumes and survives container recreation.
- **Automatic, per app:** `state.updates` = `{ apps: { id: true }, hour, day ('daily' or 0 to 6), backup, last: { id: date } }` (all off by default; `POST /api/auto-update`; an older single `autoUpdate` switch is migrated to "on" for every app when state is read). A timer in `server.js` runs every 15 minutes. When the hour (in the gateway's time zone: `TZ` in docker-compose.yml, UTC when empty) and day match, it takes the ticked apps not yet checked today, marks them checked for today first (so a failure cannot retry all hour), checks them, optionally backs each up with `uninstall.backup` (an app whose backup fails is skipped) and runs `installer.updateApps` for those with a newer image. It only runs while the gateway runs.
- **The gateway itself** (`lib/selfupdate.js`, `POST /api/self-update`): when its image has a newer digest the page offers **Update the Gateway**. A container cannot replace itself, so the gateway starts a helper container (`waypoints-gateway-updater`, image `docker:27-cli`, `--rm`) with the Docker socket and the Compose working directory mounted at the same path. The directory, project name and file list come from the `com.docker.compose.project*` labels on the gateway's own container. The helper waits 4 seconds, runs `docker compose pull gateway` and `up -d gateway`, then exits. Values are passed as environment variables, never interpolated into the script. It needs a Linux host path; if the labels are missing or the working directory is not a Linux path (Docker Desktop on Windows or macOS) the endpoint answers `422` with `manual: true` and the page shows the manual command. The page then polls `GET /api/auth` (which includes `version`) until the version changes and reloads. The restart clears in-memory sessions, so people sign in again.
- **`PRESELECT`** (environment variable, comma-separated app ids) is returned by `/api/state` as `preselect`; the wizard ticks those apps when nothing is installed yet.

## TLS

- `lan`: Caddyfile global options `local_certs` and a `tls internal` line per site. Caddy's local CA signs; devices install `root.crt` once.
- `domain`: global `email`, no `tls` line, so Caddy uses Let's Encrypt (HTTP-01 on port 80, or TLS-ALPN on 443).

## Adding an app to the catalog

Create `catalog/<id>/` with `app.json` (`id`, `name`, `description`, `port`, `container`, `fields`, `postInstall`), `compose.yml` and `own-proxy.yml`. The compose file must name its main container `container`, join the external `waypoints-proxy` network and publish no ports. No code change is needed.

## Not done yet

- Removing apps from the page (manual: `docker compose -p waypoints-<id> down`; add `-v` only to delete the data).
- Scored, Stocked, Answered, Baseball, Metered and Grifttank are not in the catalog yet (none has a standalone Docker-only compose).
- Settings schemas exist for Fond and Loadout only; Balanced and Charging have none yet (their settings live in the apps).
- Port 8080 stays published on plain HTTP; binding it to localhost once the HTTPS address works is still to do (see security.md).

## CI

`.gitea/workflows/prod.yml` runs on every push to `master` (ignoring docs paths) on a runner labeled for production: pulls the code, runs `node --check` on every JavaScript file, checks that each `catalog/<id>/` has `app.json`, `compose.yml` and `own-proxy.yml`, reads the version from `package.json`, creates a Gitea release `v<version>` if absent, then builds and pushes `ghcr.io/j5guy/waypoints-gateway:latest` and `:<version>` for `linux/amd64` and `linux/arm64`. Secrets: `GHCR_USER`, `GHCR_TOKEN`, `LOCAL_GITEA_REGISTRY_TOKEN`. The GHCR package must be public. After the image is pushed, the workflow runs the publish gate (`scripts/publish-gate.sh`), fast-forwards the public GitHub repository and creates the matching GitHub release.

The workflows contain no server address or repository path. They read two repository variables (Settings > Actions > Variables): `LOCAL_GITEA_HOST` (the bare Gitea host name, no `https://` and no `git@`) and `LOCAL_GITEA_REPO` (the repository as `owner/name`, no `.git`), and the clone address is built as `git@<LOCAL_GITEA_HOST>:/<LOCAL_GITEA_REPO>.git` (the release step uses `https://<LOCAL_GITEA_HOST>/api/v1/...`). Gitea reserves variable names that start with `GITEA_`, which is why these start with `LOCAL_`. Each workflow's first step stops with a plain message when either is empty, so the repository can be published without naming an internal host.

`scripts/check.sh` holds the checks (syntax and catalog completeness) so both workflows run the same thing.

`.gitea/workflows/test.yml` runs on a push to the `test` branch: the `checks` job on a test runner, then a deploy job on a runner with Docker builds `waypoints-gateway-test:latest` from the checkout and starts it with `docker-compose.test.yml` (local image, `pull_policy: never`, still on port 8080). Nothing is pushed to GHCR. The deploy runner needs Docker and access to the Docker socket.

`.gitea/workflows/docs.yml` syncs `docs/site` to the `gateway-waypoints` space and `docs-admin/site` to `administration`. Needs the variable `DOCS_URL` and the secrets `DOCS_TOKEN` and `ADMIN_DOCS_TOKEN`.
