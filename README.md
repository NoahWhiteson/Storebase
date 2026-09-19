# Storebase

Self-hosted Drive. Install it on a machine you own, reserve disk, and every account gets a real profile with files that live on that node — not in the browser.

```
app/       web client
server/    node: per-user drives, auth, quota, auto-update
site/      marketing landing (Vite, same UI as the app)
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
3. Later visits are sign-in. Uploads, folders, shares, trash, stars, and downloads hit the node.

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
cd site && npm install && npm run dev
./storebase update --check
```

App `43123`, landing `43124`, API `4780`. Vite proxies `/api`. Production installs serve the built app from the node port directly.

Mac client: on a Mac run `macos/make-dmg.sh`, then open Storebase.app (Dock + window + menu bar). Pair from Settings → Mac app. Details in `macos/README.md`.

## How files work

- Each signed-in user has an isolated folder on the node.
- Node reserve is the disk cap for the machine. Admins can also set a per-user GB cap in Settings → Users (blank = node default). Uploads fail if either cap would be exceeded.
- Passwords are scrypt hashes in `data/users.json`. Sessions are httpOnly cookies.
- Hidden `.trash`, `.temp`, `.versions`, `.temp-index.json`, `.trash-index.json`, and `.storebase-meta.json` live in that user’s folder.
- Right-click Share to email someone on this node, or turn on Anyone with the link for a view-only page (`/s/...`). Links can expire (1 hour / 1 day / 7 / 30 days) and can take an optional password. They cannot see the rest of the app. First-time inbound shares land in Spam until you Accept. User shares live in `data/shares.json`, links in `data/links.json`.
- Open a file to preview it (images, video, audio, PDF, markdown, text, code). Text, code, markdown, and CSV/TSV can be edited in place. Overwrites keep the last 8 versions under 80 MB (History in preview). Right-click Make a copy (or Ctrl/Cmd+D) to duplicate in place. Right-click a zip to unzip it next to the archive. Drag files or folders onto a folder (or a breadcrumb) to move them. Shift-click and Ctrl/Cmd-click select multiple items; Ctrl/Cmd-A selects all.
- Temp is a timer folder. Set 1 hour / 1 day / 3 / 7 / 30 days (or a custom day count). Each file is deleted that long after it landed in Temp. Changing the timer recalculates remaining life from when the file was added. Right-click Move to Temp, or upload while you’re on the tab. Keep in My files pulls it back out.
- The Mac app (Settings → Mac app) pairs with a link + code, watches Downloads, and can route installers to Temp. After pairing it mounts your drive as a Finder disk at `~/Storebase` (Settings → General). Reads use HTTP Range plus a 1 MB block cache, so Preview/QuickTime can start without pulling the whole object. Writes go back as ranged PUTs. It notifies you if the node is out of storage. The file list on the site updates live (SSE plus a 2s poll, no refresh) when Mac uploads or anything else writes the drive. Cloud copies in Downloads still work as stubs if that toggle is on. Delete on the Mac can trash the node copy; delete on the site removes the Mac copy too.
- Trash keeps files for 30 days, then the node deletes them. Empty trash wipes now. Files over 20 GB skip trash — the UI warns you and delete is permanent.
- Admins open Settings (gear) for platform, bind address, custom domain + auto SSL, storage cap, users, terminals, updates, and session rotation. Everyone can edit their own account. Platform copy lives in `data/settings.json`. Bind/auto-update writes `.env` and apply on restart. Domain + Let’s Encrypt certs live in `data/domain.json` and `data/certs/`. If nginx/Caddy already owns 80/443, keep them — Settings → Domain prints a reverse-proxy snippet so ACME still hits the node.
- Terminal in the sidebar/top bar opens a real shell on the node. Settings → Terminals has a master on/off, plus per-user max and idle expiry. Off hides the tab and kills live shells.
