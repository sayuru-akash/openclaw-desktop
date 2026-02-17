# OpenClaw Desktop MCP

Windows-first Electron desktop wrapper for OpenClaw with guided setup.

## MCP scope

This first cut focuses on removing CLI/JSON friction for non-technical users:

- Detect Windows + WSL + distro + `systemd` + OpenClaw CLI + gateway status.
- Run setup actions from UI:
  - One-click guided setup (`Run Guided Setup`) that chains WSL install, OpenClaw install, onboarding, and gateway start
  - Live setup progress stream (stage + command output) from main process to renderer
  - Automatic handoff from setup to embedded in-app Control UI when gateway is healthy
  - Install WSL with UAC elevation (`Start-Process wsl.exe -Verb RunAs`)
  - Persist setup state and resume after reboot
  - Install OpenClaw in WSL (`curl -fsSL https://openclaw.ai/install.sh | bash`)
  - Run onboarding (`openclaw onboard --install-daemon`)
  - Start/stop/status gateway
- Manage user-facing config from forms and persist it in app storage.

## Project structure

- `src/main/main.ts`: Electron main process and IPC handlers.
- `src/main/services/environment.ts`: Windows/WSL/OpenClaw checks and command hooks.
- `src/main/services/config-store.ts`: persisted app config.
- `src/main/services/setup-store.ts`: persisted setup state.
- `src/main/services/windows-startup.ts`: Windows Run-key registration for reboot resume.
- `src/main/services/setup-orchestrator.ts`: elevated setup + reboot-resume orchestration.
- `src/preload/preload.ts`: secure IPC bridge.
- `src/renderer/index.html`: onboarding UI shell.
- `src/renderer/app.js`: client-side setup orchestration.

## Development

```bash
npm install
npm run dev
```

Build renderer + main process:

```bash
npm run build
```

Build Windows installer (NSIS):

```bash
npm run dist
```

## Current behavior notes

- Guided setup prefers a fully automatic path and only asks for manual actions when WSL distro initialization or final gateway verification needs attention.
- Setup commands are executed through `wsl.exe bash -lc ...`.
- WSL install is requested via elevated Windows command and can require reboot.
- If reboot is required, setup state is saved and auto-resume is registered for next login on packaged builds.
- App can trigger restart directly (`shutdown.exe /r /t 5`) from the setup UI.
- Control UI is shown inside the app using an embedded webview pointed at local `http://127.0.0.1:18789/`.
- If gateway is unavailable, app falls back to setup workspace with retry actions (`Start Gateway + Retry`).
- This MCP intentionally keeps one path only: local WSL-based setup.
- Remote/fallback modes are intentionally not included yet.
