---
title: What's new
summary: Recent changes to the Waypoints Gateway. The same list is built into the Gateway.
order: 6
---

# What's new

The same plain-language list is built into the Gateway at **/whats-new** (the **What's new** link in the footer of every page, which needs no sign-in). It shows the highlights of the latest three releases, then the full notes for each.

Versions are the image tags published at `ghcr.io/j5guy/waypoints-gateway`. The Gateway's **Updates** page tells you when a newer one is available.

## 0.15.0

- Housekeeping behind the scenes: the project is now ready to be published openly. Nothing changes in how the Gateway works.

## 0.14.1

- **A tidier top bar.** The Gateway's name is on the left and the menu is on the right, like the other Waypoints apps. The version number is in the footer.
- **Pill buttons** under the app cards for the shortcuts, with a green or amber dot for the update state.
- **Follow us on X** is on its own line in the footer.

## 0.14.0

- **An encrypted setup address.** Open `https://<your computer>:8443` to set up, so your password is not sent in plain text. See [Install the Gateway](install.md#the-encrypted-setup-address).
- **Use your own certificate** for a domain install. See [Use your own certificate](own-certificate.md).
- **Older computers** (Raspberry Pi 4 and older, or processors without AVX) get MongoDB 4.4.18 automatically.
- **Settings while installing** an app, with a tickbox to use your [shared settings](shared-settings.md), and a plain list of what can only be set inside each app.

## 0.13.0

- **An uninstall script** removes the Gateway safely. See [Install the Gateway](install.md#removing-the-gateway).

## 0.12.0

- **Look for installed apps whenever you like.** A link under the cards on the home page looks again for apps installed outside the Gateway. If one cannot be brought in, the Gateway says why. See [Bring in an existing install](bring-in-an-existing-install.md).

## 0.11.2

- Housekeeping behind the scenes. Nothing changes in how the Gateway works.

## 0.11.1

- Housekeeping behind the scenes. Nothing changes in how the Gateway works.

## 0.11.0

- **A one-step installer.** One line checks that Docker is ready, starts the Gateway and prints the address to open. See [Install the Gateway](install.md#the-quickest-way-the-installer).

## 0.10.0

- **Checks before moving data.** Moving an app's data to a folder is checked first (usable, empty, big enough, and safe for that kind of data), and **Move my data** only unlocks when the checks pass. See [Where your data lives](storage.md).
- **A safer move.** The copy is compared with the original, and if the app does not start from the new place it is put back automatically.
- Folded sections show an arrow so you can tell they open.

## 0.9.1

- **Uninstall** is now always the last section on an app's page.

## 0.9.0

- **Card colors.** Give any app's card its own color so the apps you use stand out. See [Manage your apps](manage-apps.md#app-icons-and-card-colors).
- The sections in **Settings** are folded away until you open them, and so are the groups of settings inside an app.
- Sections on every page are listed **A to Z**.

## 0.8.0

- **Appearance.** Settings has an Appearance section: theme, colors for the light and dark themes, font, text size and spacing. See [Manage your apps](manage-apps.md#appearance).
- **App icons.** Each app's card shows its icon, and you can replace it with your own picture from the app's page.
- The **Running** and **Up to date** lines now line up from card to card.

## 0.7.1

- The groups on the **Shared settings** page are folded away until you open them. Each header says where the group is applied.

## 0.7.0

- **Saved secrets are encrypted.** Passwords, keys and tokens you save in the Gateway are stored encrypted, and the key is kept in its own volume. Existing ones are encrypted automatically. See [Install the Gateway](install.md#saved-passwords-and-secrets).
- Passwords are no longer written into the apps' settings files.

## 0.6.0

- **Settings are clear lists** with help text and defaults, and an **Advanced settings** section behind a warning for options only advanced users need. See [Manage your apps](manage-apps.md).
- **Where your data lives.** Keep each part of an app's data in Docker or in a folder you choose, with your existing data copied across. See [Where your data lives](storage.md).
- **Bring in an existing install.** An app you installed before the Gateway can be brought in, with its data and settings and an optional backup first. See [Bring in an existing install](bring-in-an-existing-install.md).
- **Shared settings.** Set email, directory sign-in, single sign-on, backups and the time zone once and carry them to the apps you choose. See [Shared settings](shared-settings.md).
- **Automatic updates for each app**, with a day and time and an optional backup first.
- **Hide apps you have not installed** from the home page.

## 0.5.0

- **Uninstall an app** from its page, and choose to keep its data or delete it. See [Uninstall an app](manage-apps.md#uninstall-an-app).
- **Download a backup first**: a single file with the app's database and uploaded files. Backups are listed on the Settings page.

## 0.4.0

- A **What's new** page, linked from the footer, lists every change to the Gateway.
- The footer shows the version and links to this documentation and to **Follow us on X**.

## 0.3.0

- **Password sign-in.** The first person to open a new Gateway creates a password, within 15 minutes of it starting. The Gateway also gets its own secure address.
- **A portal home page.** A card per app with an **Up to date** or **Update available** badge and an **Open** button, and grayed cards for apps you have not installed. A top menu has **Home**, **Certificates**, **Updates** and **Settings**.
- **A page for each app** with Start, Restart and Stop, plain-language checks, settings, an **Advanced** box and the log. See [Manage your apps](manage-apps.md).
- **Update the Gateway itself** with one click, and automatic updates for your apps if you want them.
- Apps you already have are marked **Installed** and are never installed twice.

## 0.2.0

- One-click updates for your apps, and optional automatic updates.
- Balanced Waypoints and Charging Waypoints can be installed from the Gateway.

## 0.1.0

The first release: click-through setup with a built-in secure proxy or settings for your own, installing Fond Waypoints and Loadout Waypoints.
