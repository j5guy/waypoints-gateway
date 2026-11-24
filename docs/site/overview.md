---
title: Waypoints Gateway
summary: A click-through setup that gives your Waypoints apps secure HTTPS addresses, with a built-in proxy or your own.
order: 1
---

# Waypoints Gateway

The Waypoints apps encrypt your information in your browser, and browsers only allow that over **HTTPS**. Setting up HTTPS (a certificate, a reverse proxy, the right headers) is the part that trips most people up. The Gateway does it for you.

It is one small container with a web page. You answer a few questions, and it:

- checks your computer for Docker and for anything already using ports 80 and 443,
- sets up a **built-in proxy** (Caddy) that handles certificates and routes every app, **or** gives you ready-to-paste settings for **your own** reverse proxy,
- installs the apps you pick, each with its database,
- ends with a list of working `https://` addresses,
- and afterward shows each app's status and updates them with one click (or automatically).

It installs **Fond Waypoints**, **Loadout Waypoints**, **Balanced Waypoints** and **Charging Waypoints**.

Several apps on one computer share a single proxy, so they never fight over ports.

## What you need

- A computer that stays on, with **Docker** and **Docker Compose** installed (Linux, a Raspberry Pi 4 or 5 on a 64-bit OS, Windows or macOS with Docker Desktop).
- For access from other devices at home: nothing else.
- For real certificates with no warnings: a domain name you control.

## Next steps

- [Install the Gateway](install.md)
- [Manage your apps](manage-apps.md) (status, updates, settings, logs, checks)
- [Shared settings](shared-settings.md) (email, sign-in, backups and time zone for several apps at once)
- [Where your data lives](storage.md)
- [Bring in an existing install](bring-in-an-existing-install.md)
- [Trust the certificate on your devices](trust-the-certificate.md) (home network setups)
- [Use your own reverse proxy](own-proxy.md)
- [Troubleshooting](troubleshooting.md)
- [What's new](whats-new.md)
