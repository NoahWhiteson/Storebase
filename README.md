# Storebase

Dark file browser in the Google Drive shape. Vite + React + TypeScript + Tailwind + shadcn/ui. Background `#1a1a1a`, Inter, cube logo.

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

- Sidebar: Home, My files, Computers, Shared, Recent, Starred, Spam, Trash, storage meter
- Search, Ask AI, grid/list toggle
- Open folders, star, share, rename, trash/restore, new folder, local file upload (stays in memory)
- Right-click context menus

All files are mock data in `src/data/files.ts`. Nothing is persisted. Ask AI answers from that in-memory list.
