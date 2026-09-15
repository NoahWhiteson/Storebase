# Storebase for Mac

macOS 14+ client. Pairs with a Storebase node, watches folders like Downloads, and uploads new files so browser downloads land in your drive instead of sitting on disk.

Double-click **Storebase.app** — it is a real app: Dock icon, window, and a cube in the menu bar. Closing the window does not quit capture.

## Install

On a Mac (this will not build on Linux):

```bash
cd macos
chmod +x make-dmg.sh
./make-dmg.sh
```

The script quits any old Storebase process (same bundle id as the first agent build), rebuilds, writes `macos/dist/Storebase.dmg`, and replaces `/Applications/Storebase.app`.

You should see **1.5** under the title and the cube icon. A hard-drive glyph means the old copy is still running — `killall Storebase` then open `/Applications/Storebase.app`. HTTP to a public IP (no domain) is supposed to work — if ATS still complains, you are on an old binary.

- First time in Xcode: open `Storebase.xcodeproj`, pick your Team under Signing, then re-run the script.
- No Apple Developer team: `UNSIGNED=1 ./make-dmg.sh` then right-click → Open the first launch (Gatekeeper).
- Signed for other machines: `TEAM_ID=YOUR10DIGIT ./make-dmg.sh`

If Finder shows a generic white document, you are on a build from before the cube icon shipped — pull `main` and rebuild.

## Pair

1. Run your Storebase node and sign in on the web app.
2. Settings → Mac app. Copy the node link and pairing code.
3. Launch Storebase on the Mac, paste both, hit Connect.
4. Turn **Capture on** (big button). New files in Downloads upload, then go to Trash locally if that setting is on.

Browsers still drop the file into Downloads first. The app waits until the download finishes, pushes it to the node, then removes the local copy.

## Settings worth knowing

- **Folders** — Downloads / Desktop / Documents / custom paths
- **Temp & routing** — which extensions (and large files) go to Temp vs My files
- **Notifications** — out of storage, errors, optional per-file
- **Storage** — quota bar; capture can pause when the node is full
- **Advanced** — settle delay, concurrent uploads, skip incomplete `.crdownload` files
