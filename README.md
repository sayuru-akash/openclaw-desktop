# OpenClaw Desktop MCP

Windows-first Electron desktop wrapper for OpenClaw with guided setup.

## Development

```bash
npm install
npm run dev
```

Run React migration preview renderer:

```bash
npm run dev:react
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


## UI overview (current)

The app is organized into three workspaces with a left-side navigation:
- `Setup`: advanced controls + status, with feature panes (Onboarding, Settings, Channels, Model, Files, Updates, Logs).
- `Chat`: embedded Chat view (webview) with gateway readiness checks.
- `Control`: embedded full Control UI (webview) with gateway readiness checks.

First-time users are routed into a dedicated **Onboarding workspace** that presents a step-by-step flow (Welcome → Node → OpenClaw → Gateway → Model → Done) plus a live setup log. The onboarding wizard is still powered by OpenClaw Gateway RPC and is available under the `Onboarding` feature pane.

## MCP scope

This first cut focuses on removing CLI/JSON friction for non-technical users:

- Detect Windows + Node.js + npm + OpenClaw CLI + gateway status.
- Run setup actions from UI:
  - First-run onboarding flow (Welcome → Node → OpenClaw → Gateway → Model/API → Chat handoff)
  - Advanced setup controls remain available outside onboarding for troubleshooting
  - One-click guided setup (`Run Guided Setup`) that chains Node.js install, OpenClaw install, and gateway readiness for onboarding
  - Live setup progress stream (stage + command output) from main process to renderer
  - In-app onboarding wizard rendered from OpenClaw Gateway RPC (`wizard.start`, `wizard.next`, `wizard.status`, `wizard.cancel`)
  - Channel-specific onboarding copy templates for WhatsApp and Telegram steps (pairing/token/workspace guidance)
  - Model-specific onboarding templates (provider/model/credential guidance)
  - WhatsApp QR-focused step UI with large scan panel and explicit scan confirmation
  - Auto-progress WhatsApp pairing checklist (`Open WhatsApp -> Linked Devices -> Scan -> Wait for Connected`)
  - Auto-progress Telegram bot checklist (`BotFather -> token -> destination -> validate`)
  - Auto-progress model checklist (`Provider -> Model -> Credential`) with current selection summary
  - Automatic handoff from setup to embedded in-app Control UI when gateway is healthy
  - Dedicated in-app Chat workspace (embedded webview to the local OpenClaw UI)
  - Dedicated in-app Control workspace (embedded webview to the local OpenClaw UI)
  - Tray support with close-to-tray behavior on Windows (app keeps running unless user selects Quit)
  - Tray gateway controls (`Status`, `Start Gateway`, `Stop Gateway`)
  - Always-on gateway toggle backed by Windows Task Scheduler (`ONLOGON` task)
  - Channel management after onboarding (WhatsApp/Telegram status, reconnect, disable)
  - Model management after onboarding (change provider/model without full onboarding rerun)
  - In-app workspace file editor for `openclaw.json`, `soul.md`, `skills.md`, `bootstrap.md`, `AGENTS.md`, and `HEARTBEAT.md`
  - Guided Telegram helper UX with BotFather copy actions and token validation
  - Auto-update checks with background download and install-on-restart flow
  - Install Node.js LTS (winget first, MSI fallback)
  - Install OpenClaw in app-managed native prefix (`npm install -g openclaw --prefix %LOCALAPPDATA%\\OpenClawDesktop\\npm`)
  - Optional CLI onboarding fallback (`openclaw onboard --install-daemon`)
  - Start/stop/status gateway
- Manage user-facing config from forms and persist it in app storage.
  - Includes profile/workspace + model provider + model name fields

## Project structure

- `src/main/main.ts`: Electron main process and IPC handlers.
- `src/main/services/environment.ts`: native Windows runtime checks and OpenClaw command hooks.
- `src/main/services/config-store.ts`: persisted app config.
- `src/main/services/setup-store.ts`: persisted setup state.
- `src/main/services/setup-orchestrator.ts`: guided native setup orchestration.
- `src/preload/preload.ts`: secure IPC bridge.
- `src/renderer/index.html`: onboarding UI shell.
- `src/renderer/app.js`: client-side setup orchestration + wizard UI logic.

## Current behavior notes

- Guided setup prefers a fully automatic path and only asks for manual actions when runtime install or gateway verification needs attention.
- Setup commands are executed natively on Windows (`node`, `npm`, `openclaw`).
- Node.js install may request elevation and can require reboot depending on installer exit code.
- TUI onboarding is replaced by UI onboarding wizard inside the app, backed by Gateway wizard RPC calls.
- App can trigger restart directly (`shutdown.exe /r /t 5`) from the setup UI.
- Control + Chat views are shown inside the app using embedded webviews pointed at local `http://127.0.0.1:18789/`.
- If gateway is unavailable, app shows fallback state with retry actions (`Start Gateway + Retry`).
- Auto-update checks require a configured publish feed in packaged builds.
- This MCP intentionally keeps one path only: native local Windows setup.
- Remote/fallback modes are intentionally not included yet.
- Windows compatibility target: Windows 10 build 19041+ and Windows 11.
