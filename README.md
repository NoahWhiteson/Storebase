# Storebase

Install it on a machine you own. Pick how much disk to reserve. That box becomes your drive — open it from anywhere in the Storebase app.

```
app/       web client
server/    node that turns a folder on this machine into the drive
```

## Run

Server first, then the app.

```bash
cd server
npm install
npm run init -- --reserve 100
npm start
```

```bash
cd app
npm install
npm run dev
```

`init --reserve 100` caps this node at 100 GB. Files live under `server/data/drive`. The process enforces the cap on write.

Default ports: app `43123`, server `4780`. Vite proxies `/api` to the server.

## How it works

1. You install Storebase on a computer with spare disk.
2. You choose a reserve size. That’s the max this node will hold.
3. The server serves that folder as your drive.
4. The app is the client. Same UI at home or on the road, as long as it can reach the node.

This repo is the UI plus a server framework: health, quota, directory listing, upload/download. Auth, remote access, and multi-node come next.
