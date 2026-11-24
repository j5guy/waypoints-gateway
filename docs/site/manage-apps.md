---
title: Manage your apps
summary: Status, updates, settings, logs and checks for every app, from one page.
order: 3
---

# Manage your apps

The menu at the top right has these pages (the Gateway's name is on the left, and **Sign out** is at the far right). The Gateway's version is in the footer:

- **Home:** a card for each app (below). Under the cards is a row of pill buttons. The first says whether everything is up to date (green) or something has an update (amber) and opens the **Updates** page. The others open the certificate steps (on a home network), hide or show the apps you have not installed, and look again for apps installed outside the Gateway.
- **Certificates:** how to trust the Gateway's certificate on each device, for home network setups.
- **Updates:** update apps and the Gateway, and set up automatic updates for each app. A number next to **Updates** in the menu shows how many updates are waiting.
- **Shared settings:** set email, directory sign-in, single sign-on, backups and the time zone once, and carry them to the apps you choose. See [Shared settings](shared-settings.md).
- **Settings:** change how the Gateway looks ([Appearance](#appearance)), the network setup (built-in proxy or your own, the address or domain), manage backups, and change the Gateway password.

## Home page

- **Installed apps** are full-color cards. They show whether the app is running and a badge: **Up to date** or **Update available** (or **Version pinned**). The **Open** button opens the app in a new tab. **Update** appears when there is a newer version. Click anywhere else on the card to manage the app.
- **Apps you have not installed** are grayed-out cards. Click one (or its **Install** button) to add it. Under the cards, **Hide apps I haven't installed** removes them from the page (and **Show apps I haven't installed** brings them back). Your choice is remembered in this browser. An **Add an app** link stays available while they are hidden.
- **An app you installed before the Gateway** gets a notice above the cards with a **Bring it in** button. See [Bring in an existing install](bring-in-an-existing-install.md).

## Updates

The **Updates** page marks each app **Update available** or **Up to date**.

- **Update** downloads the newest version and restarts that app. Your data is kept. The app is unavailable for a few seconds.
- **Update all** does every app that has an update, and refreshes the built-in proxy.
- **Automatic updates** are set for each app. Tick the apps that should update themselves, choose the day (every day, or one weekday) and the hour, and save. At that time the Gateway checks, and updates only the ticked apps that have a newer version. Everything is off by default.
  - **Back up before updating** (optional) saves a backup first. If the backup fails, that app is not updated. Backups use disk space, so delete old ones on the **Settings** page.
  - The hour is in the Gateway's time zone, which is UTC unless you set `TZ` in its compose file (for example `TZ=America/New_York`).
  - It only works while the Gateway is running. You can also switch one app on or off from its own page.

The Gateway checks itself too. The **Updates** box says **The Gateway is up to date**, or shows **A newer Gateway is available** with an **Update the Gateway** button. Press it and the Gateway downloads the new version and restarts in a few seconds. The page reconnects by itself, and you sign in again. Your apps keep running the whole time, and your settings are kept.

On some computers (for example Docker Desktop on Windows or Mac) the Gateway cannot restart itself. The page then shows the command to run in the Gateway's folder: `docker compose pull && docker compose up -d`.

## An app's page

Choose **Manage** on an app.

- **Update status** at the top: **Up to date**, or **Update available** with an **Update now** button.
- **Start, Restart, Stop.** The most common fix for a stuck app is Restart.
- **Checks** run automatically and show a green or red dot for: the app running, healthy, the database ready, the secure proxy running, and the address answering over HTTPS. Each red item says what to do next in one sentence.
- **Settings** are the everyday options, as fields with a short explanation and the default. Saving **restarts the app** for a few seconds with the new values.
  - **Fond:** who can sign up, email, how long an owner has to deny emergency access, and automatic backups.
  - **Loadout:** time zone and email.
  - **Balanced:** currency symbol, default time zone, closing sign-up, and email.
  - **Charging:** optional sign-in with your company directory (LDAP) or single sign-on.
  - Anything else is set inside the app, under Admin.
- **Advanced settings** are folded away behind a warning: **for advanced users, a wrong value can stop the app from starting.** They are named and explained, for example the database version, mail security, upload size limits, S3 media storage, a Tailscale key, a full database connection string, and certificate checks. At the bottom, **Anything else** takes any setting the app understands that is not listed, as a name and a value exactly as the app's documentation gives it.
  - **Run this version:** leave it empty to always use the newest. Enter a version number to keep the app on that version. A pinned app shows **Version pinned** and is skipped by updates, so clear it when you want to update again.
  - **Memory limit:** for example `512m` or `2g`, to keep a small computer from running out of memory.
  - If the app will not start after a change, clear what you changed and save to go back to the default.
- **Where your data lives** shows whether each part of the app's data is Docker-managed or in a folder you chose, and lets you move it. See [Where your data lives](storage.md).
- **Log** shows the app's most recent log lines. Copy them if you ask for help.
- **Info** shows the address and when it was built and started.
- **Your reverse proxy** (own-proxy setups only) has the settings to paste into nginx, Apache, Traefik, Caddy or Nginx Proxy Manager.

## Adding an app

Click a grayed-out card. It opens the app list with that app already ticked. Apps you already have are marked **Installed** and cannot be installed twice. Answer its question if it has one, and install. Your other apps are not touched, updated or restarted.

## Settings page

The sections on the **Settings** page are folded away until you open them, and are listed A to Z: **Appearance**, **Backups**, **Network**, **Password** and **Saved secrets**. Inside an app, each group of settings is folded away too. Sections on every page of the Gateway are listed alphabetically.

## Appearance

Open **Settings** and open **Appearance** to make the Gateway look the way you like. It is the same on every device and also applies to the sign-in page.

- **Theme:** match your device, light, or dark.
- **Colors:** for the light theme and the dark theme separately, choose the text, secondary text, background, accent (buttons and highlights), menu text and menu background colors. **Reset** puts one back to its default.
- **Font, text size and spacing:** choose a font (standard, serif, monospace or rounded), a text size, and comfortable or compact spacing.
- **Reduce motion** turns off hover movement and fades.

You see each change straight away. Choose **Save appearance** to keep it, or **Undo changes** to go back to what was saved.

## App icons and card colors

Each app's card on the home page shows the app's icon. To use your own picture, open the app, find **Icon and color**, and choose a file (a PNG, JPEG, WebP, GIF or SVG up to 512 KB; a square picture works best). **Use the stock icon** puts the original back.

In the same place, **Card color** tints that app's card (a colored edge and a light wash of the color) so the apps you use stand out on the home page. **Remove the color** puts it back to normal. Colors and icons are the same on every device.

## Uninstall an app

Open the app and choose **Uninstall**. Pick one:

- **Remove it, keep my data** (the default). The app stops and disappears from the Gateway, but its data stays on this computer. Install the app again later and everything is back.
- **Remove it and delete all its data.** Everything is erased: accounts, entries and uploaded files. You have to type the app's name to confirm. This cannot be undone.

Tick **Download a backup first** to save the app's database and uploaded files to one file, which you can download when it finishes. If the backup fails, nothing is removed. Deleting data turns the backup on for you.

Backups are listed on the **Settings** page, where you can download or delete them. They hold your data and the app's secrets and take up disk space, so keep a copy somewhere private and delete the rest.

Restoring from a backup file is a manual job (the file's README explains the commands). The easy way back is **Remove it, keep my data**, then install the app again.

## Changing the network setup

Open **Settings** and choose **Change network settings** to switch between the built-in proxy and your own, or to change the address or domain. Installed apps stay installed and get their new addresses.

## The Gateway's own password

Open **Settings**, then **Change the Gateway password**.
