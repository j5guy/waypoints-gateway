---
title: Install the Gateway
summary: Start the Gateway with one command, create a password, and click through the setup.
order: 2
---

# Install the Gateway

## The quickest way: the installer

On the computer that will run your apps (it needs Docker), run this one line:

```
curl -fsSL https://raw.githubusercontent.com/j5guy/waypoints-gateway/master/install.sh | bash
```

It checks that Docker is ready, saves the Gateway's files in a folder (`~/waypoints-gateway`), starts the Gateway, and prints the address to open in your browser. If something is missing (Docker is not installed or not running, or a port is taken) it says so in plain words and stops before changing anything.

- **Start with an app ticked:** add `--app fond` (or `loadout`, `balanced`, `charging`) by saving the script first: `curl -fsSL <address> -o install.sh && bash install.sh --app fond`.
- **Run it again later** to update the Gateway.
- **Prefer to do it by hand?** The steps below do the same thing.

## 1. Start it by hand

Save this as `docker-compose.yml` in a new folder (it is also in the repository as `docker-compose.yml`), then run it:

```yaml
services:
  gateway:
    image: ghcr.io/j5guy/waypoints-gateway:latest
    container_name: waypoints-gateway
    pull_policy: always
    restart: unless-stopped
    ports:
      - "8080:8080"
      - "8443:8443"
    environment:
      GATEWAY_IP: ${GATEWAY_IP:-}
      PRESELECT: ${PRESELECT:-}
    extra_hosts:
      - "host.docker.internal:host-gateway"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - gateway-data:/data
      - gateway-key:/key
      - caddy-data:/caddy-data:ro

volumes:
  gateway-data:
    name: waypoints-gateway-data
  gateway-key:
    name: waypoints-gateway-key
  caddy-data:
    name: waypoints-caddy-data
```

```
docker compose up -d
```

## 2. Open it and click through

On any device on your network, open `https://<the computer's address>:8443` (for example `https://192.168.1.20:8443`). Your browser warns once that the certificate is not trusted: that is expected (see [the encrypted setup address](#the-encrypted-setup-address)). If it will not open, use `http://<the computer's address>:8080` instead. Create a password, then follow the steps:

1. **Check.** The Gateway looks at your computer and suggests the **built-in proxy** or **your own proxy**. Pick whichever you like.
2. **Address.**
   - *Home network only:* confirm the computer's address. Your apps get names like `fond.192-168-1-20.sslip.io`, which work without any DNS setup (they do need internet access to resolve). If you run your own local DNS, choose "I have my own local name".
   - *I have a domain:* enter the domain. Point the names (for example `fond.example.com`) at this computer and forward ports 80 and 443 to it. Then choose the certificate: **free certificates from Let's Encrypt** (enter an email address) or **a certificate you already have**. See [Use your own certificate](own-certificate.md).
3. **Apps.** Tick the apps you want and confirm each address. Fond, Balanced and Charging ask for the administrator's email address. Each app also has an optional **Settings** section with the same settings its page offers later, including **Advanced settings** (behind a warning). For anything you have set up on the [Shared settings](shared-settings.md) page there is a tickbox to use it, and the section lists what can only be set inside the app. You can change all of this at any time after installing.
4. **Install.** The first time, each app is downloaded, which can take a few minutes.

When it finishes you see each app with its status and a link.

:::note Create the password soon after starting
For safety a password can only be created in the first 15 minutes after the Gateway starts. If you miss that, run `docker restart waypoints-gateway` and open the page again.
:::

## 3. Finish

- On a home network, [trust the certificate](trust-the-certificate.md) once on each device (the **Certificates** page in the menu).
- Open your app and sign up.

The Gateway stays running as your control panel. See [Manage your apps](manage-apps.md). The apps and the proxy also keep running if you stop it (`docker compose stop`), but updates and settings then wait until you start it again.

## Starting with a specific app

To open the setup with one app already ticked, start the Gateway with `PRESELECT` set to the app, for example `PRESELECT=balanced docker compose up -d`. Each product's install page does this for you. The apps you can install are Fond, Loadout, Balanced and Charging.

## Removing the Gateway

Use the uninstall script. It shows you exactly what it is going to do and asks before it changes anything. Save it first (`curl -fsSL https://raw.githubusercontent.com/j5guy/waypoints-gateway/master/uninstall.sh -o uninstall.sh`), then run `bash uninstall.sh` with one of these:

| Command | What it does |
|---|---|
| `bash uninstall.sh` | Removes the Gateway and its secure proxy. **Your apps keep running and all data stays**, but without the proxy their secure addresses stop working. |
| `bash uninstall.sh --apps` | Also removes the apps the Gateway installed. Their data stays in Docker volumes. |
| `bash uninstall.sh --data` | Also **deletes all the data**: the Gateway's settings and encryption key, the proxy's certificates and every app's data. It first copies any backups the Gateway holds to `~/waypoints-backups-<date>`, and you must type `delete my data` to go ahead. |
| `bash uninstall.sh --dry-run` | Shows what would happen and changes nothing. Add it to any of the above to try them safely. |

It only touches what the Gateway made. An app you kept from before you brought it into the Gateway (its containers are named `...-before-gateway-...`), and anything else on the computer, is never touched.

## The encrypted setup address

The installer tells you to open `https://<your computer's address>:8443`. This is the Gateway's own encrypted address, so your password is **not sent in plain text** while you set up.

- **Your browser will warn once** that the connection is not trusted. That is expected: the certificate is one the Gateway made for itself, so the browser cannot check it. Choose "Advanced", then "Continue" (the wording depends on the browser). The connection is still encrypted.
- It does not use ports 80 or 443, so it cannot clash with a web server or proxy you already run.
- The plain address, `http://<your computer's address>:8080`, still works, and the sign-in page on it points you to the encrypted one.
- After setup the Gateway also gets its normal address, `https://gateway.` plus your base name, with a proper certificate, and you can use that instead.

If you start the Gateway by hand rather than with the installer, set `GATEWAY_IP=<your computer's address>` in the `.env` file next to the compose file so the certificate matches that address.

## Raspberry Pi and older computers

MongoDB 5 and newer cannot run on a **Raspberry Pi 4 or older**, or on processors without **AVX**. The Gateway checks the computer's processor when you install an app. Where it is needed it chooses **MongoDB 4.4.18** by itself: the **Check** step says so, and the app's **Database version** setting shows it. You do not have to do anything. A Raspberry Pi 5 and current computers use the newest version. A **32-bit** system is turned away with a message: install the 64-bit operating system instead.

## Saved passwords and secrets

Passwords, keys and tokens you save in the Gateway (a mail password, a directory or single sign-on secret, an S3 key) are **stored encrypted**. The key that unlocks them is kept in its own volume, `waypoints-gateway-key`, apart from the Gateway's data. A copy or backup of the data alone therefore holds only scrambled values.

- **Keep the `gateway-key` volume.** It is in the compose file above. If it is deleted, saved secrets cannot be read and you have to enter them again. Nothing else is lost.
- **Updating from an older Gateway?** Add the `gateway-key` lines from the compose file above. Until you do, the Gateway still works and still encrypts, but the key sits beside the data, and the **Settings** page says so. Once the volume is added the key is moved there by itself.
- **What this does not do.** The Gateway has to be able to unlock secrets to start your apps, and the apps receive their passwords as settings that Docker can show to anyone with access to Docker on this computer. Encryption protects the saved files and their backups, not a person who already has full control of the computer.

## Safety

The Gateway can control Docker on this computer, so it is protected by your password, with a 15 minute lockout after 8 wrong tries. After setup it also has a secure address of its own (`https://gateway.` plus your base name). Keep port 8080 on your own network and never publish it to the internet. Forgot the password? Run `docker exec waypoints-gateway node reset-password.js` and then `docker restart waypoints-gateway`. Your apps are not touched.
