# Storebase

Self-hosted Drive. Install it on a machine you own, reserve disk, and every account gets a real profile with files that live on that node — not in the browser.

```
app/       web client
server/    node: per-user drives, auth, quota, auto-update
install.sh one-command installer
```

## Install on another machine

That’s the path you want. One command, a few questions (directory, bind address, port, auto-update, firewall), then it clones, installs Node if needed, builds, opens the port, and starts the service.

```bash
curl -fsSL https://raw.githubusercontent.com/NoahWhiteson/Storebase/main/install.sh | bash
```

Needs: `curl`, `git`, and either Node 20+ or network to download Node. Linux (systemd user service) and macOS (launchd) are supported.

After it finishes:

1. Open `http://127.0.0.1:<port>` on that machine, or `http://<lan-ip>:<port>` from another device if you bound `0.0.0.0`.
2. First visit is onboarding: admin, storage cap, optional extra users. Each user gets their own drive under `data/drive/<userId>/`.
3. Later visits are sign-in. Uploads, folders, trash, stars, and downloads hit the node.

Helper (the `storebase` script in the clone, also linked to `~/.local/bin/storebase`):

```bash
storebase update          # opt-in: pull GitHub main, rebuild UI, restart
storebase update --check  # look only
storebase status
storebase logs
storebase restart
```

Updates are opt-in. Auto-update stays off unless you said yes at install or flipped it in Settings. `storebase update` is the command that actually pulls — Settings is not required.

## Dev on this repo

```bash
cd server && npm install && npm start
cd app && npm install && npm run dev
./storebase update --check
```

App `43123`, API `4780`. Vite proxies `/api`. Production installs serve the built app from the node port directly.

## How files work

- Each signed-in user has an isolated folder on the node.
- Quota is the reserve you picked at onboarding, shared across the machine.
- Passwords are scrypt hashes in `data/users.json`. Sessions are httpOnly cookies.
- Hidden `.trash` and `.storebase-meta.json` live in that user’s folder.
- Admins open Settings (gear) for platform, bind address, storage cap, users, terminals, updates, and session rotation. Everyone can edit their own account. Platform copy lives in `data/settings.json`. Bind/auto-update writes `.env` and apply on restart.
- Terminal in the sidebar/top bar opens a real shell on the node. Settings → Terminals sets per-user max and idle expiry.
