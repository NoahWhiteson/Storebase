# Storebase server

Turns a directory on this machine into a Drive backend. You pick a size cap; writes past that fail.

```bash
npm install
npm run init -- --reserve 100
npm start
```

| Flag / env | Default | Meaning |
|---|---|---|
| `--reserve` / `STOREBASE_RESERVE_GB` | `10` | Max GB this node will store |
| `--dir` / `STOREBASE_DATA_DIR` | `./data` | Where the drive lives |
| `--port` / `STOREBASE_PORT` | `4780` | HTTP port |
| `--host` / `STOREBASE_HOST` | `127.0.0.1` | Bind address |

`data/storebase.json` holds the reserve. `data/drive/` is the actual file tree.

## API

- `GET /api/health`
- `GET /api/status` — reserved vs used, host, data dir
- `GET /api/files?path=` — list a folder
- `POST /api/files/mkdir` — `{ path }`
- `POST /api/files/upload?path=` — multipart field `file`
- `GET /api/files/download?path=`
- `DELETE /api/files?path=`

No auth yet. Bind to localhost until there is.
