# Storebase server

Turns a directory on this machine into a Drive backend. You pick a size cap; writes past that fail.

```bash
npm install
npm start
```

Open the app. If this node has no admin yet, onboarding sets the owner account, the disk reserve, and optional extra users.

| Flag / env | Default | Meaning |
|---|---|---|
| `--dir` / `STOREBASE_DATA_DIR` | `./data` | Where the drive lives |
| `--port` / `STOREBASE_PORT` | `4780` | HTTP port |
| `--host` / `STOREBASE_HOST` | `127.0.0.1` | Bind address |
| `--reserve` / `STOREBASE_RESERVE_GB` | `10` | Only for `npm run init` |

`data/storebase.json` holds the reserve. `data/users.json` holds accounts (scrypt hashes). `data/drive/` is the file tree.

## API

- `GET /api/health`
- `GET /api/setup` — `{ configured, disk, admin? }`
- `POST /api/setup` — `{ admin, reserveGb, users? }` once
- `GET /api/status` — reserved vs used (after setup)
- `GET /api/files?path=` — list a folder
- `POST /api/files/mkdir` — `{ path }`
- `POST /api/files/upload?path=` — multipart field `file`
- `GET /api/files/download?path=`
- `DELETE /api/files?path=`
