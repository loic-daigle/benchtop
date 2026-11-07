# Benchtop

A desktop app to browse all your maker projects — code, PCB, 3D and docs — in one place.

## Features

- **Dashboard** with a card per project: cover image, description, status, tags, Git state and what it contains (Code / PCB / 3D). Filter by status, tag or content, sort by date / name / status.
- **Pinned** projects on top and a **Recently opened** row.
- **Groups**: a plain folder holding several projects (like `Software/`) shows each project separately.
- **Instant startup** from a saved scan, then a background rescan. A **folder watcher** updates cards, the file tree and previews when files change.
- **Project page** with three tabs:
  - **Files**: file tree + preview (images, Markdown, code with syntax colours, CSV / BOM tables including EasyEDA's UTF-16 exports). Back / forward with `Alt+←/→` or the mouse side buttons. Open folders are remembered per project.
  - **Overview**: edit status, description, tags, links (GitHub, EasyEDA, YouTube, MakerWorld, JLC…) and the cover image. Git panel: branch, uncommitted changes, ahead/behind, last commit, link to the repo.
  - **Notes**: `NOTES.md` with to-do checkboxes you can tick, autosaved.
- **Ctrl+K**: jump to any project or file. **Ctrl+Shift+F**: search inside files across all projects (or just the open one); click a result to open the file at that line.
- One-click **Open in VS Code**, **terminal here**, **Explorer**.

### What Benchtop writes

Only two files, and only when you edit them in the app:

- `project.yaml` (project info: status, tags, links, cover). Comments and extra keys you add by hand are kept.
- `NOTES.md` (project notes).

Everything else is read-only. App settings (pins, recent, cache) live in Benchtop's own app-data folder.

```yaml
# project.yaml example
status: active          # idea | active | paused | done | archived
description: Matter scroll-wheel remote for ESP32-C6
tags: [esp32, matter, video]
cover: docs/media/smart-scroll-remote.jpg
links:
  github: https://github.com/loic-daigle/smart-scroll-remote
  youtube: https://youtu.be/...
```

Shortcuts: `Ctrl+K` go to · `Ctrl+Shift+F` search in files · `Esc` back to dashboard · `Alt+←/→` file history.

## Run it

Requirements: [Node.js](https://nodejs.org) 20 or newer. [Git](https://git-scm.com) for the Git panel (optional).

```powershell
cd "C:\Users\loic\Desktop\Projets\Software\benchtop"
npm install
npm start
```

On first launch it uses `Desktop\Projets` automatically. Click the folder path in the top bar to pick another one.

## Install it as an app

```powershell
npm run make
```

This builds `out\make\squirrel.windows\x64\Benchtop-Setup.exe` (a few minutes the first time). Run it: Benchtop installs for your
Windows user (no admin), opens, and adds itself to the Start menu and the desktop. Uninstall it from Windows Settings → Apps.

- Settings, pins, the EasyEDA pairing code and the GitHub sign-in are shared with `npm start` (same `%APPDATA%\Benchtop` folder).
- Only one Benchtop runs at a time; launching it again brings the open window forward. Close the `npm start` one first.
- The EasyEDA extension (`benchtop-easyeda.eext`) is included: Benchtop → EasyEDA window → click its name to find it.
- The installed app updates itself from this repo's GitHub releases (see below). Your settings stay.

## Publish a new version (auto-update)

Installed copies check [update.electronjs.org](https://update.electronjs.org) at start and every hour. It reads the public
releases of `loic-daigle/benchtop`; a newer version is downloaded in the background and Benchtop offers to restart.

1. Bump `version` in `package.json` (e.g. `1.0.0` → `1.0.1`). Same version = no update.
2. Commit and push.
3. `npm run publish` — builds the installer and uploads it as a GitHub release `v1.0.1`.
   It needs a token that can create releases: the GitHub CLI's login (`gh auth login`), or `$env:GITHUB_TOKEN = "ghp_…"`.

The first install still comes from `Benchtop-Setup.exe` (from `npm run make` or the release page). The app isn't code-signed, so
Windows SmartScreen asks once: *More info → Run anyway*. Updates after that install silently.

## Development

| Command | What it does |
|---|---|
| `npm start` | Run the app with live reload |
| `npm run typecheck` | TypeScript check |
| `npm test` | Unit tests for the folder scanner |
| `npm run make` | Build the installer (`out\make\squirrel.windows\x64\Benchtop-Setup.exe`) |
| `npm run publish` | Build and upload a GitHub release (auto-update) |
| `npm run build:easyeda` | Build the EasyEDA extension (`easyeda-extension\dist\benchtop-easyeda.eext`) |

Stack: Electron + Electron Forge (Vite plugin), React 19 + TypeScript, plain CSS, highlight.js, react-markdown.

```
src/
  main/        Electron main process — scanner, store (cache + watcher), project.yaml, git, search, settings
  preload.ts   The small API the UI is allowed to call
  shared/      Types and file-category rules used by both sides
  renderer/    React UI (components/, styles/ — plain CSS, lib/)
```

Security: the UI has no Node access (`contextIsolation`, `sandbox`); every file request is checked to be inside the projects folder.

## Roadmap

- STEP / STL 3D viewer, Gerber viewer, PDF preview
- "New project" button with a standard folder template
- Publish to GitHub
