---
space: administration
path: gateway-security
title: "Gateway: security"
summary: "The Docker socket, the password, request checks, and what the gateway stores."
---

# Gateway: security

## The Docker socket

The container mounts `/var/run/docker.sock` and runs as root, because it must start containers. **Access to the socket is equivalent to root on the host.** Anything that can use the gateway's setup page can start containers with host access. Controls:

- The page needs an **administrator password**. The first visitor creates it, but only within **15 minutes of the container starting** (so a forgotten, unclaimed gateway does not stay open); restarting opens a new window. It is stored as a scrypt hash (random 16-byte salt) in `/data/auth.json`, mode `0600`, and compared with `crypto.timingSafeEqual`. `reset-password.js` deletes that file (run it with `docker exec`, then restart).
- **Lockout:** 8 wrong passwords from one address lock that address for 15 minutes; 40 failures anywhere in 15 minutes lock everyone out for the rest of that window.
- **Session:** random 256-bit token in an `HttpOnly`, `SameSite=Strict` cookie, 12 hours, kept in memory (a restart signs everyone out). The cookie is not `Secure` because the page is served over plain HTTP on the LAN by design.
- **Request checks:** every `POST` must be `application/json`, and when the browser sends `Origin` it must match `Host`. Request bodies are limited to 64 KB.
- **Headers:** a strict Content-Security-Policy (no inline scripts or styles), `X-Frame-Options: DENY`, `nosniff`, `no-referrer`, `no-store`.
- **No shell:** every command runs through `execFile` with an argument array. Hostnames, ports, emails and bind addresses are validated, and the only app images that can be started are those in `catalog/`.
- `POST /api/test` only probes hostnames that are in the saved state, so it cannot be used to scan other hosts.

The gateway is meant to stay running (status, updates, settings), which makes it a permanent root-equivalent control point. In built-in mode it also gets its own HTTPS address, `https://gateway.<baseName>`: setup attaches the `waypoints-gateway` container to the proxy network and adds a site for it to the Caddyfile. The session cookie gets `Secure` when the request arrives with `X-Forwarded-Proto: https`. Port 8080 is still published over plain HTTP, so: never publish it to the internet and keep it on a trusted network. Still to do: an option to bind 8080 to localhost once the HTTPS address works.

## Settings and secrets

App settings are stored in `state.json` (`apps.<id>.settings`, `apps.<id>.extra`, and `shared.<group>.values` for the Shared settings page, mode `0600`) and in the override files `/data/overrides/<id>.yml` (mode `0600`).

**Secrets are encrypted at rest** (`lib/secrets.js`). A value counts as a secret when its catalog definition has type `secret`, when its name matches `/secret|pass|token|key|pwd|pw$/i`, or when it is a secret field of a Shared settings group. `state.write` replaces each with an `enc:v1:<iv>:<tag>:<ciphertext>` token (AES-256-GCM, a fresh random IV each time, authenticated, so tampering is detected) and `state.read` decrypts in memory. The 32-byte key is generated on first use in `master.key` in a separate Docker volume (`waypoints-gateway-key`, mounted at `/key`; the check is whether `/key` is a mount point in `/proc/self/mountinfo`). If it is not mounted the key stays in `/data` (a warning is logged and the Settings page says so) and is moved to `/key` automatically once the volume appears. A secret that cannot be decrypted becomes empty and is logged. At start `state.migrate` encrypts anything an older version saved in plain text.

**Secrets are not written to the override files.** `compose.writeOverride` writes `NAME: "${NAME}"` for a secret, and `installer.composeEnv` (via `secrets.composeSecrets`) passes the real value in the environment of the `docker compose` process, from memory. Every compose command the gateway runs uses `composeEnv`, so a recreate always carries the secret. Compose does not interpolate `$` inside a substituted value.

**What this does not protect against:** root on the host or access to the Docker socket reaches the key, the data and the running containers; the apps receive secrets as environment variables, so they are visible with `docker inspect`; and backups made before an uninstall contain each app's own secrets volume unencrypted. Not done: a key derived from the sign-in password (which would stop unattended restarts and automatic updates after a reboot) and passphrase-encrypted backups. The browser never receives the saved state: `GET /api/state` returns only addresses, ports and the sign-up fields (`publicState`), `GET /api/shared` and the app info route return secrets only as "set or not", and a blank secret field keeps the saved value. The exception is the Advanced section's free-form rows, which are returned as typed (the page hides values whose name looks like a secret, but they are in the response), so use a listed setting of type secret where one exists. Treat the `waypoints-gateway-data` volume like the settings of the apps themselves.

Bringing in an existing install copies the old install's environment, which can include secrets; those are saved the same way. The old containers are kept stopped (renamed, restart policy off) and still hold their data until the person removes them.

## What it stores

`state.json` has hostnames, the ACME email and per-app settings such as Fond's `ADMIN_EMAIL`. No passwords or keys. Caddy's CA private key lives in the `waypoints-caddy-data` volume (read-only in the gateway); treat that volume like a private key and back it up with care. Anyone who obtains it can issue certificates your devices trust.

## The encrypted setup address and certificates

Until setup gives the Gateway its own proxy address, sign-in is also offered on `https` port 8443 with a **self-signed** certificate the Gateway made. That keeps the password out of plain text on the network, but because nothing vouches for the certificate it does not stop someone actively impersonating the Gateway: the person clicks through a warning. After setup, use `https://gateway.<base name>` (a certificate your devices trust). The self-signed key (`gateway-tls.key`, mode 0600) is kept beside the secrets key.

**A certificate supplied by the person** (domain installs) is saved with its private key as files in `/data/certs` (mode 0600) and mounted read-only into the proxy. The key is **not encrypted at rest** (the proxy needs to read it), unlike the passwords in state; treat the `waypoints-gateway-data` volume accordingly. It is never sent back to the browser: the Certificates page only receives names, subject and expiry (`customCertInfo`). `--data` in `uninstall.sh` deletes it with the volume.

## Backups

Backups made before an uninstall contain the app's database dump and its volumes, which include secrets such as the session secret. They are stored in `/data/exports` (mode 0600, inside the `waypoints-gateway-data` volume), only downloadable by a signed-in user, and never deleted automatically. The Settings page lists them so they can be downloaded and deleted. Treat that volume as sensitive and keep exported files private.

## Plain HTTP on the setup page

Until the gateway has its HTTPS address (it is created during setup), the password is typed and sent over plain HTTP on the local network, so someone on the same network could observe it. Create the password on a trusted network and, once setup is done, use the `https://gateway.<base name>` address.
