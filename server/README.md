# Storebase server

Turns a directory on this machine into a Drive backend. Each signed-in user gets their own folder. Writes past the node reserve fail.

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
| `STOREBASE_HOME` | repo root | Clone used for GitHub auto-update |
| `STOREBASE_AUTO_UPDATE` | unset | Set to `1` to pull `main` and rebuild |
| `STOREBASE_APP_DIST` | `app/dist` | Built client to serve |

`data/storebase.json` holds the reserve. `data/users.json` holds accounts (scrypt hashes). `data/drive/<userId>/` is that user’s files. `data/secret.json` signs session cookies.

## API

- `GET /api/health`
- `GET /api/setup` — `{ configured, disk, admin? }`
- `POST /api/setup` — `{ admin, reserveGb, users? }` once; sets a session cookie
- `POST /api/login` — `{ email, password }`
- `POST /api/logout`
- `GET /api/me` — current user + quota
- `GET /api/status` — reserved vs used
- `GET /api/files?path=&view=` — `drive` (default), `trash`, `starred`, `recent`, `search`
- `POST /api/files/mkdir` — `{ path }`
- `POST /api/files/upload?path=` — multipart field `file`
- `POST /api/files/rename` — `{ path, name }`
- `POST /api/files/star` — `{ path, starred }`
- `POST /api/files/trash` — `{ path }`
- `POST /api/files/restore` — `{ path }`
- `GET /api/files/download?path=`
- `DELETE /api/files?path=`
- `GET/POST /api/update` — admin; check or apply GitHub `main`
