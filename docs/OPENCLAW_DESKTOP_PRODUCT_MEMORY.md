# OpenClaw Desktop Product Memory

Last updated: 2026-02-22

## 1) Product Goal

Build a Windows-first desktop app (Electron) that makes OpenClaw usable for non-technical users.

The user should:
- install one `.exe`
- click through guided setup
- complete onboarding in app UI
- use OpenClaw features inside the app (no browser tab required)

## 2) Target User

Primary user:
- non-technical Windows user
- no npm/terminal knowledge
- no manual JSON config editing

Design principle:
- if a step can be automated safely, automate it
- if manual action is unavoidable, provide one clear instruction and a retry button

## 3) Core Architecture

Separate app from OpenClaw repo (no fork required for wrapper flow).

Our app responsibilities:
- Windows prerequisite checks
- Node.js runtime bootstrap (auto-install)
- OpenClaw native install in app-managed prefix
- gateway lifecycle (start/stop/status)
- onboarding wizard UI
- in-app embedded control experience

OpenClaw responsibilities:
- CLI/runtime behavior
- gateway service
- onboarding wizard logic (RPC)
- control UI served locally by gateway

## 4) Integration Model With OpenClaw

### 4.1 Commands we run
- `node --version`
- `npm --version`
- `npm install -g openclaw --prefix %LOCALAPPDATA%\OpenClawDesktop\npm --no-fund --no-audit`
- `openclaw gateway start|stop|status`

### 4.2 Onboarding method (primary)
- Use Gateway wizard RPC from app UI:
- `wizard.start`
- `wizard.next`
- `wizard.status`
- `wizard.cancel`

TUI onboarding (`openclaw onboard`) is fallback only.

### 4.3 Control experience
- Embedded inside Electron using local Control UI URL:
- `http://127.0.0.1:18789/`

No external browser dependency for normal user flow.

## 5) Required User Flow

1. Install app (`.exe`).
2. First launch runs environment checks.
3. If Node.js runtime missing, app installs Node.js LTS (winget first, MSI fallback).
4. App installs OpenClaw natively.
5. App starts gateway and verifies health.
6. User completes onboarding via in-app wizard UI.
7. App switches automatically to embedded Chat view.

## 6) Non-Technical UX Rules

- Never require terminal use.
- Never require editing `openclaw.json`.
- Use human language, not infra language.
- One primary action per screen.
- Show progress continuously for long operations.
- Show actionable failures:
- what failed
- what app tried
- one-click retry/fix

## 7) Setup/Recovery Requirements

- Handle UAC prompts clearly.
- Persist setup stage and keep retry flow simple.
- Support retry at each failed step.
- Keep logs visible and exportable for support.

## 8) Security/Hardening Requirements

- `contextIsolation: true`
- `nodeIntegration: false`
- strict IPC surface (allowlist channels only)
- open external links outside app intentionally
- prefer secure secret storage (Windows Credential Manager via `keytar`)

## 9) Current Product Decisions

- Focus on native local Windows OpenClaw setup.
- No WSL path in current product.
- No OpenClaw fork for wrapper layer.
- In-app onboarding wizard is mandatory path (TUI fallback only).
- In-app Control embedding is default post-setup experience.
- Current channel template focus in onboarding UX: WhatsApp + Telegram.
- WhatsApp onboarding includes QR-focused visual step UI with scan confirmation.
- WhatsApp onboarding includes auto-highlighted pairing checklist states in UI.
- Telegram onboarding includes auto-highlighted BotFather/token/chat/validation checklist states.

## 10) Done vs Next

Implemented:
- native Windows setup orchestration
- Node.js auto-install flow (winget + MSI fallback)
- OpenClaw native install via npm prefix
- live setup progress stream
- in-app wizard RPC wiring
- embedded Control/Chat workspaces with fallback

Next priorities:
1. Improve wizard step UX polish and validation.
2. Add diagnostics export + support bundle.
3. Expand Win10/Win11 VM test matrix coverage.
4. Ship signed installer + auto-update.

## 11) Definition of Success

Success means a fresh non-technical Windows user can go from zero to working OpenClaw in under ~10 minutes, without terminal commands, browser setup, or manual config files.
