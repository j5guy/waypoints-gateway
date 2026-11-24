---
title: Where your data lives
summary: Docker-managed storage or a folder you choose, how your data is checked and moved, and how to move it back.
order: 4
---

# Where your data lives

Every app keeps its data in a few places: the **database**, **uploaded files**, **backups**, the **secrets** the app made for itself, and some small settings and log files.

By default Docker looks after all of these. That is safe through updates and restarts, but you cannot easily see the files, back them up, or put them on another disk.

Instead you can keep a part of an app's data in a **folder on this computer**. It is then easy to find, back up and move.

:::tip A good setup
Keep the **Database** and the **Backups** on different disks, and back up the folders you choose yourself. A backup on the same disk as the database does not protect you from that disk failing.
:::

## Move data to a folder

1. Open the app and find **Where your data lives**. It lists each part of the app's data and where it is now: **Docker-managed** or **Folder: ...**.
2. Open the part you want to move. The choices are right there: **Docker-managed** or **A folder on this computer**.
3. For a folder, enter the full path, for example `/mnt/disk2/fond-database`.
4. Choose **Check this location**. The Gateway tells you in plain words what it found.
5. When the checks pass, choose **Move my data** and confirm.

### What the checks look at

The checks run **before anything is stopped or changed**. Each result is green, a note, or red. Only red stops the move.

- The folder name is valid and is not a system folder (such as `/etc` or `/var`).
- It does not overlap another folder you chose for this app **or any other app**.
- Docker can write to it.
- It is **empty**, so two sets of data are never mixed (or, if you ticked **This folder already holds my data**, it is not empty).
- There is **enough free space** for your data. You get a note if space is tight.
- For the **Database**, it is not on a **network drive** (NFS, SMB and similar). A database can lose or damage data on a network drive, so keep the Database on a disk inside this computer and put Backups on the network drive instead.

The same checks run again when you press **Move my data**, so they cannot be skipped.

### What happens during the move

1. The app **stops**, so nothing changes while it is copied.
2. Your data is **copied**, then the copy is **compared with the original**. If it does not match, nothing is changed and the app starts again as before.
3. The app **starts from the new place**, and the Gateway waits for it to be healthy.
4. If it does **not** come up, the old place is **put back automatically** and the app is restarted, so you are never left without your data.

**Your old copy is always kept** where it was. Delete it yourself once you have checked that everything works.

## Move it back

Open the part, choose **Docker-managed**, check, and move. The data is copied back into a Docker volume.

## Using a folder that already holds the data

If you kept a folder when you uninstalled an app, and want to use it again, install the app, open the part, choose the folder, and tick **This folder already holds my data**. The Gateway then uses it as it is, without copying.

## Good to know

- The folder path must start with `/` and use only letters, numbers, dots, dashes and underscores.
- Uninstalling an app and choosing to delete its data **does not delete a folder you chose**. The Gateway tells you which folders were left, so you can delete them yourself if you no longer need them.
- A backup made by the Gateway includes data kept in folders.
