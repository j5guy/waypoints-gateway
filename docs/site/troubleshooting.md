---
title: Troubleshooting
summary: Fixes for the problems people hit most when setting up the Gateway.
order: 5
---

# Troubleshooting

| Problem | Cause | What to do |
|---|---|---|
| "Restart to set a password" | A password can only be created in the first 15 minutes after the Gateway starts | Run `docker restart waypoints-gateway`, then open the page again |
| I forgot the Gateway password | | Run `docker exec waypoints-gateway node reset-password.js`, then `docker restart waypoints-gateway`. Your apps are not touched |
| "Too many wrong tries" | 8 wrong passwords from one device | Wait 15 minutes |
| A saved password or secret has gone blank | The `waypoints-gateway-key` volume was deleted or replaced, so saved secrets cannot be unlocked | Enter the secret again on the app's page or under Shared settings. Keep that volume from now on |
| The browser warns that `https://<address>:8443` is not trusted | The Gateway's encrypted setup address uses a certificate the Gateway made for itself | Expected. Choose "Advanced", then "Continue". The connection is still encrypted. See [Install the Gateway](install.md#the-encrypted-setup-address) |
| MongoDB stops with "Illegal instruction" on a Raspberry Pi or an older computer | MongoDB 5 and newer need processor features that older hardware lacks | The Gateway picks MongoDB 4.4.18 for new apps by itself. For an app installed before that, open it, then Settings, Advanced settings, Database version, and choose MongoDB 4.4.18 (a fresh install is safest: an existing database should not be switched back) |
| "That certificate does not cover ..." when using your own certificate | The certificate's names do not include one of your app addresses | Use a wildcard certificate (`*.example.com`) or one that lists every address. See [Use your own certificate](own-certificate.md) |
| "That private key does not belong to that certificate" | The key and certificate are from different requests | Use the key that was made with the certificate request |
| Something is wrong with one app | | Open the Gateway, choose **Manage** on the app, and read the **Checks**. Each red item says what to do |
| "Docker did not answer" on the first step | The Docker socket is not mounted, or Docker is not running | Check the `/var/run/docker.sock` line in the compose file and that Docker is running |
| The built-in proxy will not start ("port is already allocated") | Something else uses port 80 or 443 | Go back and choose **I already have a reverse proxy**, or stop the other program |
| A page loads with no styling and the browser console shows `ERR_SSL_PROTOCOL_ERROR` | You opened an app over plain `http://` from another device. The apps require HTTPS | Use the app's `https://` address. See [Install the Gateway](install.md) |
| The browser warns the connection is not private (home network) | The device does not trust the Gateway's certificate yet | [Trust the certificate](trust-the-certificate.md) once on that device |
| The `sslip.io` address does not open | The device cannot resolve it (no internet DNS, or a router that blocks private answers) | Use your own local name (advanced option on the Address step), or add the address to your router's DNS |
| Real certificate never arrives (domain setup) | The name does not point at this computer, or ports 80 and 443 are not reachable from the internet | Fix DNS and port forwarding, then run `docker logs waypoints-caddy` to see what Let's Encrypt said |
| "The certificate is not ready yet" | The proxy has not issued a certificate yet | Open one of your apps once, wait a few seconds, reload the page |
| An app shows "unhealthy" or "starting" for a minute | The database is still starting | Wait; a first start can take up to a minute on a small computer |
| Fond or Loadout installed earlier by hand | The Gateway installs its own copies | Run setup with the same ports free, or keep the old install and use **your own proxy** mode |
