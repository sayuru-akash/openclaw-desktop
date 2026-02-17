# OpenClaw Desktop Product Memory

Last updated: 2026-02-17

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
- Windows + WSL checks/install
- OpenClaw install in WSL
- gateway lifecycle (start/stop/status)
- onboarding wizard UI
- in-app embedded control experience

OpenClaw responsibilities:
- CLI install and runtime in WSL
- gateway service
- onboarding wizard logic (RPC)
- control UI served locally by gateway

## 4) Integration Model With OpenClaw

### 4.1 Commands we run
- `wsl.exe --status`
- `wsl.exe --install` (elevated when needed)
- `wsl.exe bash -lc "curl -fsSL https://openclaw.ai/install.sh | bash"`
- `wsl.exe bash -lc "openclaw gateway start|stop|status"`

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
3. If WSL missing, app requests elevation and installs WSL.
4. If reboot required, app saves state and resumes after login.
5. App installs OpenClaw in WSL.
6. App starts gateway and verifies health.
7. User completes onboarding via in-app wizard UI.
8. App switches automatically to embedded Control view.

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
- Detect reboot-required states and continue automatically.
- Persist setup stage so app can resume safely.
- Support retry at each failed step.
- Keep logs visible and exportable for support.

## 8) Security/Hardening Requirements

- `contextIsolation: true`
- `nodeIntegration: false`
- strict IPC surface (allowlist channels only)
- open external links outside app intentionally
- prefer secure secret storage (Windows Credential Manager via `keytar`)

## 9) Current Product Decisions

- Focus on local WSL-based OpenClaw setup first.
- No remote fallback mode in initial scope.
- No OpenClaw fork for wrapper layer.
- In-app onboarding wizard is mandatory path (TUI fallback only).
- In-app Control embedding is default post-setup experience.
- Current channel template focus in onboarding UX: WhatsApp + Telegram.
- WhatsApp onboarding includes QR-focused visual step UI with scan confirmation.
- WhatsApp onboarding includes auto-highlighted pairing checklist states in UI.
- Telegram onboarding includes auto-highlighted BotFather/token/chat/validation checklist states.

## 10) Done vs Next

Implemented:
- elevated WSL setup + reboot-resume
- guided setup orchestration
- live setup progress stream
- in-app wizard RPC wiring
- embedded Control workspace with fallback

Next priorities:
1. Improve wizard step UX polish and validation.
2. Add diagnostics export + support bundle.
3. Add robust test matrix on clean Win10/Win11 VMs.
4. Ship signed installer + auto-update.

## 11) Definition of Success

Success means a fresh non-technical Windows user can go from zero to working OpenClaw in under ~10 minutes, without terminal commands, browser setup, or manual config files.
