# Storebase for Mac

Menu bar client (macOS 14+). Pairs with a Storebase node, watches folders like Downloads, and uploads new files so browser downloads land in your drive instead of sitting on disk.

## Install

1. On a Mac, clone this repo (or copy `macos/`).
2. Open `macos/Storebase.xcodeproj` in Xcode 15+.
3. Select the Storebase target → Signing & Capabilities → your Team.
4. Product → Archive, or just Run. The app lives in the menu bar, not the Dock.

You can drag `Storebase.app` to `/Applications` after a Release build.

## Get a DMG

There isn’t a prebuilt disk image in the repo — it has to be compiled on a Mac.

```bash
cd macos
chmod +x make-dmg.sh
./make-dmg.sh
```

That writes `macos/dist/Storebase.dmg`. Open it and drag Storebase onto Applications.

- First time in Xcode: open `Storebase.xcodeproj`, pick your Team under Signing, then re-run the script.
- No Apple Developer team (just you): `UNSIGNED=1 ./make-dmg.sh` then right-click → Open the first launch (Gatekeeper).
- Signed for other machines: `TEAM_ID=YOUR10DIGIT ./make-dmg.sh`

Or in Xcode: Product → Archive → Distribute App → Copy App, then:

```bash
hdiutil create -volname Storebase -srcfolder /path/to/Storebase.app -ov -format UDZO Storebase.dmg
```

## Pair

1. Run your Storebase node and sign in on the web app.
2. Settings → Mac app. Copy the node link and pairing code.
3. Click the menu bar drive icon → Settings → Connection. Paste both, hit Connect.
4. Turn **Capture on** (big button, like a VPN). New files in Downloads upload, then go to Trash locally if that setting is on.

Browsers still drop the file into Downloads first. The app waits until the download finishes, pushes it to the node, then removes the local copy. That’s as close as a Mac app can get without a browser extension.

## Settings worth knowing

- **Folders** — Downloads / Desktop / Documents / custom paths
- **Temp & routing** — which extensions (and large files) go to Temp vs My files
- **Notifications** — out of storage, errors, optional per-file
- **Storage** — quota bar; capture can pause when the node is full
- **Advanced** — settle delay, concurrent uploads, skip incomplete `.crdownload` files
