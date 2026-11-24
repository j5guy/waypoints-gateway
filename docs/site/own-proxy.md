---
title: Use your own reverse proxy
summary: Skip the built-in proxy and put the apps behind nginx, Apache, Traefik, Caddy or Nginx Proxy Manager you already run.
order: 4
---

# Use your own reverse proxy

If something already uses ports 80 and 443 on your computer (a web server, Traefik, Nginx Proxy Manager, a router add-on), only one thing can own them. Choose **I already have a reverse proxy** on the Gateway's first step.

The Gateway checks for this itself and recommends it when it finds something. The check is best effort: it can see Docker and what answers on ports 80 and 443, not every program on your computer, so you always make the final choice.

## What changes

- The built-in proxy is **not** installed (and is removed if you had installed it).
- Each app publishes **one port** on this computer, for your proxy to forward to. Fond defaults to `5560` and Loadout to `5556`. You can change them.
- You choose where that port listens:
  - **Only on this computer** (`127.0.0.1`, recommended) if your proxy runs on the same computer.
  - **On my whole network** (`0.0.0.0`) if your proxy runs on another computer. Anyone on your network could then also reach the app directly over plain HTTP, so firewall it if that matters.
- On each app's card, **Settings for your reverse proxy** has ready-to-paste settings for nginx, Apache, Traefik, Caddy and Nginx Proxy Manager, with your address and port filled in.
- **Test** fetches the app over HTTPS through your proxy and tells you whether it answered.

## What your proxy must do

Whatever proxy you use, the generated settings do these things, and a hand-written config needs them too:

- Serve the app over **HTTPS** (a real or trusted certificate).
- Pass the **WebSocket upgrade** headers.
- Send `X-Forwarded-For`, `X-Forwarded-Proto` and `X-Forwarded-Host`.
- Allow uploads of at least **150 MB** (`client_max_body_size 150M` in nginx).

## Telling the app about the proxy

- **Fond** believes forwarded addresses only from a proxy on a private network (the same computer, your LAN or Docker). Nothing to set in that case. If your proxy has a public address, set `TRUST_PROXY` to the number of proxies in front of it (usually `1`).
- **Loadout** is installed with `TRUST_PROXY=1` and a `PUBLIC_URL` that matches the address you entered.

If you change the address later, run setup again so the apps pick it up.
