---
title: Trust the certificate on your devices
summary: On a home network, each phone or computer trusts the Gateway's certificate once so the browser shows no warning.
order: 3
---

# Trust the certificate on your devices

When you choose **Only on my home network**, the built-in proxy makes its own certificate authority (CA) and signs each app's certificate. It cannot be a public authority, because nobody can issue a public certificate for a private address. So each device must be told once to trust this CA. Until it does, the browser shows a warning, and the app will not work until you accept it.

You only need to do this **once per device**, not once per app.

1. In the Gateway, open **Certificates** in the top menu and choose **Download the certificate**. The file is called `waypoints-local-ca.crt`.
2. Install it on the device:

**Windows**
1. Double-click the file and choose **Install Certificate**.
2. Choose **Local Machine** (or Current User), then **Place all certificates in the following store**.
3. Browse, pick **Trusted Root Certification Authorities**, finish, and restart the browser.

**Mac**
1. Double-click the file to add it to Keychain Access (System keychain).
2. Double-click the new entry, open **Trust**, and set **When using this certificate** to **Always Trust**.

**iPhone or iPad**
1. Open the file in Safari and allow the profile to download.
2. **Settings > Profile Downloaded > Install**.
3. **Settings > General > About > Certificate Trust Settings**, and turn the certificate on.

**Android**
1. **Settings > Security > Encryption & credentials > Install a certificate > CA certificate**.
2. Choose the downloaded file. Menu names vary by phone.

**Linux**
Copy the file to `/usr/local/share/ca-certificates/` and run `update-ca-certificates`. Firefox keeps its own list: **Settings > Privacy & Security > Certificates > View Certificates > Authorities > Import**.

:::tip Want no setup at all?
A real domain name gets certificates every device already trusts, so there is nothing to install. Choose **I have a domain name** in the Gateway.
:::

:::warning Keep the certificate private to your own devices
Anyone who installs it trusts everything this computer signs. Only install it on devices you own or manage.
:::
