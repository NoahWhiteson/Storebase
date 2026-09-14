# Storebase

Install it on a machine you own. Pick how much disk to reserve. That box becomes your drive — open it from anywhere in the Storebase app.

```
app/       web client
server/    node that turns a folder on this machine into the drive
```

## Run

Server first, then the app.

`npm start` is enough. If nobody has finished onboarding, the app sends you there: admin name/email/password, how much disk to reserve, optional extra users.

```bash
cd server
npm install
npm start
```

```bash
cd app
npm install
npm run dev
```

Default ports: app `43123`, server `4780`. Vite proxies `/api` to the server. Files live under `server/data/drive`. Passwords are stored as scrypt hashes in `server/data/users.json`.

## How it works

1. You install Storebase on a computer with spare disk.
2. First visit runs onboarding: admin account, storage reserve, optional extra users.
3. The server serves that folder as your drive.
4. The app is the client. Same UI at home or on the road, as long as it can reach the node.

This repo is the UI plus a server framework: health, quota, directory listing, upload/download. Auth, remote access, and multi-node come next.
