// Public, plain-language release notes shown at /whats-new. Newest first.
//
// This is the user-facing rewrite of RELEASE_NOTES (which is written for developers and stays the source of truth).
// Add an entry here, bump package.json, and add a RELEASE_NOTES heading for every change; scripts/check.sh fails CI
// when the newest entry here, the newest RELEASE_NOTES heading and package.json do not all name the same version.
//
// `highlights`: short bullets shown for the latest releases.
// `notes`: optional fuller write-up, [{ title, text }]. Plain text, no HTML.
module.exports = [
    {
        version: 'v0.15.0',
        highlights: [
            'Housekeeping behind the scenes: the project is now ready to be published openly. Nothing changes in how the Gateway works'
        ]
    },
    {
        version: 'v0.14.1',
        highlights: [
            'The top bar now matches the other Waypoints apps: the name on the left, the menu on the right',
            'The shortcuts under your app cards are now pill buttons',
            'Follow us on X is on its own line in the footer'
        ]
    },
    {
        version: 'v0.14.0',
        highlights: [
            'An encrypted address for setting up the Gateway, so your password is not sent in plain text',
            'Use your own certificate for a domain install, checked against your addresses before it is used',
            'Raspberry Pi 4 and older computers get the right MongoDB version automatically',
            'Set an app\'s settings while installing it, and tick whether to use your shared settings'
        ],
        notes: [
            {
                title: 'Encrypted setup address',
                text: 'The installer now tells you to open https://your-computer:8443. Your browser warns once because the certificate is the Gateway\'s own: that is expected, and the connection is still encrypted, so your password is not sent in plain text. The plain address still works.'
            },
            {
                title: 'Your own certificate',
                text: 'For a domain install you can choose Use a certificate I already have, then paste or choose the certificate and its private key. The Gateway checks they match, have not expired, and cover every address your apps will use. The Certificates page shows when it runs out and lets you replace it.'
            },
            {
                title: 'Older computers',
                text: 'MongoDB 5 and newer cannot run on a Raspberry Pi 4 or older, or on processors without AVX. The Gateway now notices this when you install an app and uses MongoDB 4.4.18 by itself. A 32-bit system is turned away with a clear message to use the 64-bit version.'
            },
            {
                title: 'Settings while installing',
                text: 'Each app you install can be given its settings straight away: the same everyday and Advanced settings as its page. For anything you have set up on the Shared settings page there is a tickbox to use it, and the Gateway says plainly what can only be set inside each app.'
            }
        ]
    },
    {
        version: 'v0.13.0',
        highlights: [
            'An uninstall script removes the Gateway safely: it shows what it will do, asks first, and never deletes data unless you say so'
        ]
    },
    {
        version: 'v0.12.0',
        highlights: [
            'Look for apps installed outside the Gateway whenever you like, from the home page',
            'If an app cannot be brought in, the Gateway now says why'
        ],
        notes: [
            {
                title: 'Look again for installed apps',
                text: 'Under the app cards, choose Look for apps installed outside the Gateway. If it finds one it can bring in, the Bring it in notice appears above the cards. If not, it says so, and explains anything that looked like one of your apps but could not be brought in, for example an app built from source.'
            }
        ]
    },
    {
        version: 'v0.11.2',
        highlights: [
            'Housekeeping behind the scenes: nothing changes in how the Gateway works'
        ]
    },
    {
        version: 'v0.11.1',
        highlights: [
            'Housekeeping behind the scenes: nothing changes in how the Gateway works'
        ]
    },
    {
        version: 'v0.11.0',
        highlights: [
            'A one-step installer: one line checks Docker, starts the Gateway and tells you the address to open'
        ]
    },
    {
        version: 'v0.10.0',
        highlights: [
            'Moving your data to a folder is checked first, and the choice is easy to see',
            'If an app will not start from the new place, it is put back automatically',
            'Folded sections now show an arrow so you can tell they open'
        ],
        notes: [
            {
                title: 'Checks before a move',
                text: 'On an app\'s Where your data lives section, open a part of the data, choose a folder and press Check this location. The Gateway tells you in plain words whether the folder is usable, empty, big enough and safe for that kind of data (a database should not live on a network drive). Move my data only unlocks when the checks pass, and the same checks run again before anything is touched.'
            },
            {
                title: 'A safer move',
                text: 'After your data is copied it is compared with the original. When the app starts from the new place, the Gateway waits for it to be healthy. If it does not come up, the old place is put back and the app restarted, so nothing is lost. Your old copy is always kept.'
            }
        ]
    },
    {
        version: 'v0.9.1',
        highlights: [
            'Uninstall is now always the last section on an app\'s page'
        ]
    },
    {
        version: 'v0.9.0',
        highlights: [
            'Give any app\'s card its own color, so the apps you use stand out on the home page',
            'The sections in Settings are folded away until you open them',
            'Sections on every page are now listed A to Z'
        ],
        notes: [
            {
                title: 'Card colors',
                text: 'Open an app and use Icon and color to pick a color for its card. The card gets a colored edge and a light tint on the home page. Remove the color to go back to normal.'
            },
            {
                title: 'Tidier pages',
                text: 'The sections in Settings, and each group of settings inside an app, are folded away until you open them. Sections on every page are listed alphabetically, so they are easy to find.'
            }
        ]
    },
    {
        version: 'v0.8.0',
        highlights: [
            'Make the Gateway look the way you like: theme, colors for light and dark, font, text size and spacing',
            'Every app has its own icon on its card, and you can replace it with your own picture',
            'The Running and Up to date lines now line up from card to card'
        ],
        notes: [
            {
                title: 'Appearance',
                text: 'Settings now has an Appearance section, like the other Waypoints apps. Pick light, dark or match your device; change the text, secondary text, background, accent and menu colors for each theme, with a Reset on each; and choose a font, a text size and compact or comfortable spacing. You see changes straight away, and when you save they apply on every device.'
            },
            {
                title: 'App icons',
                text: 'Each app\'s card shows its icon. Open an app and use the Icon section to upload your own picture (PNG, JPEG, WebP, GIF or SVG up to 512 KB), or switch back to the stock icon whenever you like.'
            }
        ]
    },
    {
        version: 'v0.7.1',
        highlights: [
            'The groups on the Shared settings page are folded away until you open them, and each shows where it is applied'
        ]
    },
    {
        version: 'v0.7.0',
        highlights: [
            'Passwords and keys you save in the Gateway are now encrypted, and the key is kept in its own volume',
            'Passwords are no longer written into the apps\' settings files'
        ],
        notes: [
            {
                title: 'Saved secrets are encrypted',
                text: 'Mail passwords, directory and single sign-on secrets, tokens and other secrets are stored encrypted. Anyone who copies the Gateway\'s data, or an old backup of it, gets scrambled values. The key that unlocks them is kept in a separate volume. Existing secrets are encrypted automatically the first time the new version starts.'
            },
            {
                title: 'Keep the key volume',
                text: 'Add the new gateway-key volume from the updated compose file. Do not delete it: without it, saved secrets cannot be read and have to be entered again. The Settings page tells you whether the key is kept apart.'
            }
        ]
    },
    {
        version: 'v0.6.0',
        highlights: [
            'Settings are clear lists with help text, and an Advanced section with a warning for the options only advanced users need',
            'Choose where your data lives: Docker-managed or a folder you pick, with your existing data copied across',
            'Bring an app you installed before the Gateway into it, with its data and settings, and an optional backup first',
            'Shared settings: set email, directory sign-in, single sign-on, backups and the time zone once and carry them to the apps you choose',
            'Automatic updates are now set for each app, with a day and time and an optional backup first',
            'Hide the grayed-out cards for apps you have not installed'
        ],
        notes: [
            {
                title: 'Shared settings',
                text: 'Open Shared settings to set email, company-directory (LDAP) sign-in, single sign-on, automatic backups and the time zone once. Choose all apps that use them, including ones you install later, or tick the apps you want. The Gateway gives each app the settings under that app\'s own names and restarts the ones that changed.'
            },
            {
                title: 'Automatic updates for each app',
                text: 'On the Updates page, tick the apps that should update themselves, then choose the day and the hour. The Gateway checks at that time and updates only the ticked apps that have a newer version. You can also have it back up an app first, and skip the update if the backup fails. Each app\'s own page has the same switch.'
            },
            {
                title: 'Settings and Advanced settings',
                text: 'Each app\'s page lists its everyday settings as fields with a short explanation and the default. Options only advanced users need are in a collapsed Advanced settings section with a warning, and every one is named and explained. A last Anything else area takes any setting that is not listed. Saving restarts the app for a few seconds.'
            },
            {
                title: 'Where your data lives',
                text: 'Docker keeps your data safe through updates and restarts, but you cannot easily see or back it up. Each app\'s Storage card shows where every part of its data is, and lets you move it to a folder you choose, for example on another disk. The Gateway copies your data first, starts the app from the new place and keeps the old copy until you delete it.'
            },
            {
                title: 'Bring in an existing install',
                text: 'If an app was installed before the Gateway, the home page offers to bring it in. Your data and settings are copied, a backup can be taken first, and the old install is stopped and kept, renamed, as a safety copy. If anything goes wrong the old install is started again.'
            },
            {
                title: 'Hide apps you have not installed',
                text: 'On the home page, choose Hide apps I haven\'t installed to see only your own apps. Your choice is remembered in this browser.'
            }
        ]
    },
    {
        version: 'v0.5.0',
        highlights: [
            'Uninstall any app from its page, keeping your data or deleting it',
            'Download a backup of an app\'s database and files before you remove it'
        ],
        notes: [
            {
                title: 'Uninstall',
                text: 'Open an app and choose Uninstall. Remove it and keep my data stops the app but leaves its data on this computer, so installing it again brings everything back. Remove it and delete all its data erases everything, and asks you to type the app\'s name first.'
            },
            {
                title: 'Backups',
                text: 'Either choice can download a backup first: one file with the app\'s database and uploaded files. If the backup fails, nothing is removed. Backups are listed on the Settings page, where you can download or delete them. They hold your data, so keep them somewhere private.'
            }
        ]
    },
    {
        version: 'v0.4.0',
        highlights: [
            'A What\'s new page, linked from the footer, lists every change to the Gateway',
            'The footer now shows the version and links to the documentation and to us on X'
        ],
        notes: [
            {
                title: 'What\'s new',
                text: 'The footer of every page has a What\'s new link. It opens a page, with no sign-in needed, listing the highlights of the latest releases and the full notes for each.'
            },
            {
                title: 'Footer links',
                text: 'The footer also links to the Gateway documentation and to Follow us on X, like the other Waypoints apps.'
            }
        ]
    },
    {
        version: 'v0.3.0',
        highlights: [
            'Sign in with a password you create the first time you open the Gateway',
            'The home page is a set of cards, one per app, with an Up to date or Update available badge, and grayed cards for apps you have not installed',
            'A page for each app with Start, Restart and Stop, plain-language checks, settings, an Advanced box and the log',
            'Update the Gateway itself with one click, plus a menu for Certificates, Updates and Settings'
        ],
        notes: [
            {
                title: 'Password sign-in',
                text: 'The first person to open a new Gateway creates a password, within 15 minutes of it starting. Forgot it? Run docker exec waypoints-gateway node reset-password.js, then restart the Gateway. The Gateway also gets its own secure address, https://gateway. followed by your base name.'
            },
            {
                title: 'Manage each app',
                text: 'Open an app to see whether it is healthy, restart it, change its settings, read its log and run checks that tell you what to do about anything that is wrong. The Advanced box lets you add any extra setting, keep an app on a version, and limit its memory.'
            },
            {
                title: 'Updates',
                text: 'Each app shows whether a newer version is available, and one button updates it. You can turn on automatic updates, and update the Gateway itself from its own page. Your data is kept.'
            },
            {
                title: 'Adding apps',
                text: 'Apps you already have are marked Installed and are never installed twice. Click a grayed card to add another app without being asked the network questions again.'
            }
        ]
    },
    {
        version: 'v0.2.0',
        highlights: [
            'One-click updates for your apps, and optional automatic updates',
            'Balanced Waypoints and Charging Waypoints can be installed from the Gateway'
        ]
    },
    {
        version: 'v0.1.0',
        highlights: [
            'The first release: click-through setup with a built-in secure proxy or settings for your own, installing Fond Waypoints and Loadout Waypoints'
        ]
    }
];
