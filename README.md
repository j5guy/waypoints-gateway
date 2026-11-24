# Waypoints Gateway

> One click-through setup that gives your Waypoints apps secure HTTPS addresses, installs them, and then keeps them
> updated. No certificates to make, no proxy to write, no compose files to edit.

The Gateway is a small web page that runs in Docker on your own computer. You answer a few questions, and it:

- checks your computer for Docker and for anything already using the web ports,
- sets up a built-in secure proxy, or gives you ready-to-paste settings for the proxy you already run,
- installs the apps you pick (Fond Waypoints, Loadout Waypoints, Balanced Waypoints and Charging Waypoints), each with
  its database,
- and then shows each app's status, updates it, backs it up, and lets you change its settings from one place.

📖 Documentation: <https://support.allthewaypoints.com/docs/gateway-waypoints/overview>

## What you need

A computer that stays on, with **Docker** and **Docker Compose** installed (Linux, a Raspberry Pi 4 or 5 on a 64-bit
operating system, or Windows or macOS with Docker Desktop), and ports 80, 443, 8080 and 8443 free.

## Install

Run this one line on that computer:

```bash
curl -fsSL https://raw.githubusercontent.com/j5guy/waypoints-gateway/master/install.sh | bash
```

It checks that Docker is ready, saves the Gateway's files in `~/waypoints-gateway`, starts it, and prints the address to
open. If you would rather read the script first, download it and run it yourself:

```bash
curl -fsSL https://raw.githubusercontent.com/j5guy/waypoints-gateway/master/install.sh -o install.sh
bash install.sh
```

To start with an app already ticked, add `--app fond` (or `loadout`, `balanced`, `charging`).

### Then

1. Open the address it prints, `https://<your computer's address>:8443`. Your browser will warn once that the connection
   is not trusted. That is expected: the certificate is one the Gateway made for itself, and the connection is still
   encrypted, so your password is not sent in plain text. Choose "Advanced", then "Continue".
2. Create a password within 15 minutes of the Gateway starting. (If you miss that, run
   `docker restart waypoints-gateway` and open the page again.)
3. Follow the steps: pick **Home network only** (or your domain), tick the apps you want, and install.
4. On a home network, install the certificate once on each device from the **Certificates** page. After that your apps,
   and the Gateway itself at `https://gateway.<your address>.sslip.io`, show as secure.

## Updating and removing

- **Update:** run the installer again, or use the Gateway's **Updates** page (it updates your apps too, and can do it
  automatically).
- **Remove:** `bash uninstall.sh`. It lists exactly what it will do and asks before changing anything. By default it
  removes only the Gateway and its proxy and leaves your apps and data alone; `--apps` also removes the apps, and
  `--data` also deletes all the data (after copying out any backups, and only if you type a confirmation). Add
  `--dry-run` to see what would happen without changing anything.

## Good to know

- The Gateway controls Docker on your computer through the Docker socket, so it is protected by a password you create.
  Keep its ports on your own network and never publish them to the internet.
- Passwords and secrets you save in it are stored encrypted, with the key in a separate Docker volume
  (`waypoints-gateway-key`). Keep that volume.
- It is new software. Back up anything you care about before moving an existing install into it (it offers to take a
  backup first).

## Release notes

See [RELEASE_NOTES](RELEASE_NOTES) for the version history.

## Support

Questions or problems: <https://support.allthewaypoints.com> or support@allthewaypoints.com.

## License

[MIT](LICENSE)
