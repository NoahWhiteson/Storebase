# Storebase app

Web client for a Storebase node. Drive-style UI, `#1a1a1a`, Inter, cube logo.

```bash
npm install
npm run dev
```

Dev server: `127.0.0.1:43123`. `/api` proxies to the node on `4780`.

```bash
npm run build
npm run preview
```

The file list is still mock data in `src/data/files.ts` until the client talks to `GET /api/files`. First visit hits `/api/setup` and onboarding if the node has no admin.

