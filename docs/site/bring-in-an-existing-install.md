---
title: Bring in an existing install
summary: Move an app you installed before the Gateway under the Gateway's management, with its data and settings.
order: 5
---

# Bring in an existing install

If you installed an app yourself before the Gateway existed, the Gateway can take it over, so you get the same updates, settings, checks and secure address as any other app.

## How you know it found one

After setup, the Gateway's home page shows a notice like **Fond Waypoints is already installed on this computer**, with a **Bring it in** button. It looks for apps running from the published Waypoints images that it does not manage yet.

## Looking again

The Gateway looks for installed apps when the home page opens. To look again at any time (for example after you start an old install), choose **Look for apps installed outside the Gateway** under the cards on the home page.

- If it finds one it can bring in, the notice with **Bring it in** appears above the cards.
- If it finds nothing, it says **No apps found outside the Gateway**.
- If something looks like one of your apps but cannot be brought in automatically, it tells you why. For example, it found the app but not its database (the database must have been started from the same compose file), or the app is not running from the published image because it was built from source.

## What happens

1. **A backup** (optional, ticked by default) is taken first, while the old install is still running. If the backup fails, nothing is changed.
2. The old app and its database are **stopped**.
3. They are **renamed** and kept as a safety copy. Nothing is deleted.
4. Your **data is copied** into the Gateway's storage.
5. Your **settings come across** too: everything the old install was started with, including options the Gateway does not list (they appear under **Advanced settings > Anything else**).
6. The app **starts under the Gateway** at the address you chose, and the secure proxy is set up for it.

If any step fails, the old install is started again and the Gateway says so. Nothing is lost.

## Before you start

- Finish the Gateway setup first (the home page needs to be working).
- Choose the new address in the **Address** box. The old address stops working.

## After it finishes

Open the app and check that your data is there. The old containers are stopped and renamed like `fondwaypoints-app-before-gateway-20261124`. Once you are happy, remove them from the computer's terminal (use the names shown on the last page):

```
docker rm fondwaypoints-app-before-gateway-20261124 fondwaypoints-mongo-before-gateway-20261124
```

Their old data volumes stay until you remove them too. They are your safety copy, so keep them until you are sure.

## What it cannot bring in automatically

- An install that uses **its own database server** or a database login. The Gateway says so and changes nothing.
- An install built from source rather than the published image, or one without its own MongoDB container.

For those, install the app fresh from the Gateway and restore a backup into it.
