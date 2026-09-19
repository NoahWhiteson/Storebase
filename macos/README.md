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

You should see **1.17** under the title and the cube icon. After pairing, Finder gets a **Storebase** disk (`~/Storebase`) — apps read byte ranges through a local cache instead of downloading the whole file first. Toggle it in Settings → General. Unselect a captured Downloads stub and it still shrinks back. Opening a stub hands off to Preview without bringing the Storebase window forward. A hard-drive glyph means the old copy is still running — `killall -9 Storebase` then open `/Applications/Storebase.app`. HTTP to a public IP (no domain) is supposed to work — if ATS still complains, you are on an old binary.

- First time in Xcode: open `Storebase.xcodeproj`, pick your Team under Signing, then re-run the script.
- No Apple Developer team: `./make-dmg.sh` ad-hoc signs. Right-click → Open the first launch if Gatekeeper complains.
- Signed for other machines: `TEAM_ID=YOUR10DIGIT ./make-dmg.sh`
- Full xcodebuild log: `VERBOSE=1 ./make-dmg.sh`

If Finder shows a generic white document, you are on a build from before the cube icon shipped — pull `main` and rebuild.

## Pair

1. Run your Storebase node and sign in on the web app.
2. Settings → Mac app. Copy the node link and pairing code.
3. Launch Storebase on the Mac, paste both, hit Connect.
4. Turn **Capture on** (big button). New files in Downloads upload, then stay as cloud copies — same name, same Finder icon, almost no disk — unless you change Storage.

Double-click a cloud copy: Storebase downloads the real bytes into that same Finder file and opens Preview / QuickTime / whatever owns the type. Drag it to Desktop, Mail, Messages, etc. and the drop gets the real photo, not the empty stub — click first so the download can start. Unselect it (or close the app that opened it) and the Downloads copy shrinks back to the ~127-byte stub. Existing `.storebase` files convert back to the original name the first time the app ticks.

Deleting that file in Downloads (or another watched folder) moves it to Trash on the node if **Keep deletes in sync** is on (default). Trash or delete it on the website and the Mac copy goes away too. Turn the toggle off in Settings → Storage to stop local→cloud delete; cloud→local still happens for cloud copies so Finder doesn’t keep a ghost file.

Browsers still drop the file into Downloads first. The app waits until the download finishes, pushes it to the node, then replaces the local bytes with a tiny cloud copy. It is not a `.storebase` file.

## Settings worth knowing

- **Folders** — Downloads / Desktop / Documents / custom paths
- **Temp & routing** — which extensions (and large files) go to Temp vs My files
- **Notifications** — out of storage, errors, optional per-file
- **Storage** — quota bar; cloud copies; mirror local deletes onto the node; capture can pause when the node is full
- **Transfer** — progress while a file moves; menu-bar chips for space left and active transfers (next to battery); speed cap (unlimited, Wi-Fi-aware, or custom so uploads don’t eat the radio)
- **Advanced** — settle delay, concurrent uploads, skip incomplete `.crdownload` files
