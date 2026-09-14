# Drive

Dark-mode Google Drive UI. Vite + React + TypeScript + Tailwind + shadcn/ui. Background is `#1a1a1a`, type is Inter.

## Run

```bash
npm install
npm run dev
```

Dev server binds `127.0.0.1:43123`.

```bash
npm run build
npm run preview
```

## What it does

- Sidebar: Home, My Drive, Computers, Shared, Recent, Starred, Spam, Trash, storage meter
- Search, grid/list toggle, details panel
- Open folders, star, share, rename, trash/restore, new folder, local file upload (stays in memory)
- Right-click context menus

All files are mock data in `src/data/files.ts`. Nothing is persisted.
