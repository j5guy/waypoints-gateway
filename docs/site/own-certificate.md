---
title: Use your own certificate
summary: For a domain install, use a certificate you already have instead of free Let's Encrypt certificates.
order: 7
---

# Use your own certificate

In a **domain install** the Gateway gets free certificates from Let's Encrypt by default. If you already have a certificate, for example a wildcard certificate for `*.example.com` from your company or provider, you can use that instead.

## Choosing it

On the **Address** step, choose **I have a domain name**, then under **Certificate** choose **Use a certificate I already have**. Then:

1. Paste the **certificate** (or choose the file). Use the full chain file if your provider gave you one.
2. Paste the **private key** (or choose the file). It must not be protected by a passphrase.
3. Choose **Check the certificate**.

## What is checked

Each result is plain: red means it cannot be used, yellow is worth knowing, green is fine.

- It is a certificate, and the key is a private key.
- **They belong together.** A key from another certificate is refused.
- The key has **no passphrase**. If it has one, the message shows the command to remove it.
- It has **not expired** (and is already valid). You get a note if it ends within 30 days.
- It **covers every address your apps will use**, for example `gateway.example.com`, `fond.example.com`. A wildcard such as `*.example.com` covers one level only, so `a.b.example.com` is not covered. This is checked again on the last step with your real addresses, and **Install stays locked until it passes**.
- You get a note if it is **self-signed** (every device must then be told to trust it) or if only one certificate is in the file, because browsers also need the intermediate certificates.

## Looking after it

The **Certificates** page shows what the certificate covers and when it runs out, and warns when it is close. **You renew it yourself.** When you have a new one, paste it there (or choose the files), and the Gateway checks it against your addresses before it starts using it. If the check fails, the old certificate stays in use.

## Good to know

- One certificate is used for the Gateway's own address and every app, so it must cover them all (a wildcard is the easy way).
- The private key is kept on the Gateway for the proxy to use, with owner-only permissions, and is never shown again. Unlike the passwords you save in the Gateway, it is **not encrypted on disk**, because the proxy has to read the file.
- Using your **own proxy** instead? Then certificates are managed there. See [Use your own reverse proxy](own-proxy.md).
