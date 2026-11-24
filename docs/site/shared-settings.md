---
title: Shared settings
summary: Set email, directory sign-in, single sign-on, backups and the time zone once, and carry them to the apps you choose.
order: 6
---

# Shared settings

Several of your apps need the same things: a mail server, a company directory to sign in with, a backup schedule, a time zone. Instead of entering them in each app, set them once on the **Shared settings** page and choose which apps get them.

## The groups

| Group | What it covers |
|---|---|
| **Email** | Mail server, port, user, password, the address mail is sent as, and whether the connection is secure |
| **Sign in with your company directory (LDAP)** | Directory address, service account, where to search, and the certificate check |
| **Single sign-on (OIDC)** | Provider address, client ID and secret, and scopes |
| **Automatic backups** | Whether to back up, how often and how many to keep |
| **Time zone** | The time zone people see dates in |

## Set a group once

Each group is folded away until you open it, and its header says where it is applied: **Applied to all apps that use it**, **Applied to 2 apps**, or **Not applied yet**.

1. Open **Shared settings** in the menu, then open a group and fill it in.
2. Under **Apply to**, choose **All apps that use these settings** (including apps you install later), or tick the apps you want.
3. Choose **Save and apply**.

The Gateway gives each app the settings under that app's own names (the apps do not all call them the same thing), and restarts the apps that changed for a few seconds. Each app shows how many of the group's settings it uses, because not every app uses every setting. For example Fond sends email but has no single sign-on, and Charging has sign-in options but sends no email.

## When you install an app

Each new app's **Settings** section on the install step has a tickbox for every shared group the app can use, for example **Use the shared Email settings**.

- It is **ticked** when the group is set up and covers the app, so your settings are used without any typing. Untick it to give this app its own instead.
- It is **greyed out, with an explanation**, when the group is not set up yet. Set it up on this page first, or fill in the app's own settings.
- While a group is ticked, the matching settings are hidden in the app's own list, so nothing is set twice.
- An app that uses a group takes part in it from then on: saving the group here later reaches it too.

## What cannot be set from the Gateway

Not every setting can be shared, and some can only be set inside an app. The Gateway says so wherever you look at an app's settings, in a box titled **Not set from the Gateway, only inside the app**. For example, Charging has no email setting here because each person connects their own mail server, and Balanced's bank connection is made inside Balanced. A setting that a shared group also sets is marked **Also set by Shared settings**.

## Good to know

- **The Shared settings page decides for the apps it is applied to.** A setting left empty there is removed from those apps. To give one app a different value, untick it on the group, then set its own value on the app's page.
- **Unticking an app later does not undo anything.** It keeps the values it already has.
- **New apps** pick up every group set to **All apps** when you install them.
- **Passwords and secrets** are saved on the Gateway (in its private storage) and are never shown again: a saved one says **Saved. Type to replace it.**, with a link to clear it.
- A setting saved inside an app (for example under its Admin pages) can still take priority over the one the Gateway gives it. The app's own documentation says which wins.
