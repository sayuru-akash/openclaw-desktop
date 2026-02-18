# OpenClaw Desktop MCP

Windows-first Electron desktop wrapper for OpenClaw with guided setup.

## MCP scope

This first cut focuses on removing CLI/JSON friction for non-technical users:

- Detect Windows + WSL + distro + `systemd` + OpenClaw CLI + gateway status.
- Run setup actions from UI:
  - One-click guided setup (`Run Guided Setup`) that chains WSL install, OpenClaw install, and gateway readiness for onboarding
  - Live setup progress stream (stage + command output) from main process to renderer
  - In-app onboarding wizard rendered from OpenClaw Gateway RPC (`wizard.start`, `wizard.next`, `wizard.status`, `wizard.cancel`)
  - Channel-specific onboarding copy templates for WhatsApp and Telegram steps (pairing/token/workspace guidance)
  - Model-specific onboarding templates (provider/model/credential guidance)
  - WhatsApp QR-focused step UI with large scan panel and explicit scan confirmation
  - Auto-progress WhatsApp pairing checklist (`Open WhatsApp -> Linked Devices -> Scan -> Wait for Connected`)
  - Auto-progress Telegram bot checklist (`BotFather -> token -> destination -> validate`)
  - Auto-progress model checklist (`Provider -> Model -> Credential`) with current selection summary
  - Automatic handoff from setup to embedded in-app Control UI when gateway is healthy
  - Dedicated in-app Chat workspace (streaming chat via embedded OpenClaw WebChat view)
  - Tray support with close-to-tray behavior on Windows (app keeps running unless user selects Quit)
  - Tray gateway controls (`Status`, `Start Gateway`, `Stop Gateway`)
  - Always-on gateway toggle backed by Windows Task Scheduler (`ONLOGON` task)
  - Channel management after onboarding (WhatsApp/Telegram status, reconnect, disable)
  - Model management after onboarding (change provider/model without full onboarding rerun)
  - In-app workspace file editor for `openclaw.json`, `soul.md`, `skills.md`, `bootstrap.md`, `AGENTS.md`, and `HEARTBEAT.md`
  - Guided Telegram helper UX with BotFather copy actions and token validation
  - Auto-update checks with background download and install-on-restart flow
  - Install WSL with UAC elevation (`Start-Process wsl.exe -Verb RunAs`)
  - Persist setup state and resume after reboot
  - Install OpenClaw in WSL (`curl -fsSL https://openclaw.ai/install.sh | bash`)
  - Optional CLI onboarding fallback (`openclaw onboard --install-daemon`)
  - Start/stop/status gateway
- Manage user-facing config from forms and persist it in app storage.
  - Includes profile/workspace + model provider + model name fields

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

Run unit tests:

```bash
npm test
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
- TUI onboarding is replaced by UI onboarding wizard inside the app, backed by Gateway wizard RPC calls.
- App can trigger restart directly (`shutdown.exe /r /t 5`) from the setup UI.
- Control UI is shown inside the app using an embedded webview pointed at local `http://127.0.0.1:18789/`.
- If gateway is unavailable, app falls back to setup workspace with retry actions (`Start Gateway + Retry`).
- Auto-update checks require a configured publish feed in packaged builds.
- This MCP intentionally keeps one path only: local WSL-based setup.
- Remote/fallback modes are intentionally not included yet.
- Windows compatibility target: Windows 10 build 19041+ and Windows 11.
