# OpenClaw Desktop

Windows-first (with macOS local-flow support) Electron wrapper for [OpenClaw](https://github.com/openclaw)—a desktop app that automates WSL2 bootstrap on Windows, manages local runtime on macOS, installs OpenClaw, and provides a guided onboarding UI so non-technical users can run OpenClaw without touching a terminal or editing config files.

---

## Repository Structure

```
├── src/
│   ├── main/                 # Electron main process (TypeScript)
│   │   ├── main.ts           # Entry point, window management, IPC handlers
│   │   └── services/         # Environment, gateway, auto-updater, config store
│   ├── preload/              # Preload script exposing secure API to renderer
│   ├── renderer/             # Legacy vanilla JS renderer (fallback)
│   ├── renderer-react/       # React + Tailwind UI (default)
│   │   ├── src/
│   │   │   ├── components/   # UI components (shadcn/ui style)
│   │   │   ├── pages/        # Route-level views (Chat, Settings, Models, etc.)
│   │   │   └── lib/          # Utilities and logger
│   │   └── index.html
│   └── shared/               # Shared TypeScript types between main/renderer
├── auth-web/                 # Next.js auth web app (Clerk + Drizzle ORM)
│   ├── app/                  # API routes for auth, billing, desktop handoff
│   └── db/                   # Database schema
├── website/                  # Marketing site (Vite + React + Framer Motion)
├── assets/                   # Branding, icons, logos
├── docs/                     # Product memory, UI previews, test matrices
├── tests/                    # Node.js test suite (parsers, orchestrator)
├── scripts/                  # Build helpers (copy-renderer, verify-artifacts)
└── .github/workflows/        # CI/CD for release builds
```

---

## Build & Development Commands

### Root (Electron App)

```bash
# Install dependencies
npm install

# Development (builds and launches Electron)
npm run dev

# Build all targets for release
npm run build

# Run tests (builds main then runs Node test runner)
npm test

# Build Windows installer (.exe)
npm run dist:win

# Build macOS installers (.dmg, .pkg, .zip)
npm run dist:mac

# Build all platforms (requires compatible runners)
npm run dist:all

# Verify release artifacts
npm run verify:artifacts
npm run verify:artifacts:win
npm run verify:artifacts:mac

# Clean build output
npm run clean
```

### Auth Web (Next.js)

```bash
cd auth-web
npm install
npm run dev        # Next.js dev server
npm run build      # Production build
npm run lint       # ESLint
```

### Website (Vite)

```bash
cd website
npm install
npm run dev        # Vite dev server
npm run build      # Production build
npm run preview    # Preview production build
```

---

## Code Style & Conventions

- **Language**: TypeScript (strict mode enabled)
- **Formatter**: No explicit formatter configured; follow existing patterns
- **Linting**: ESLint in website/; `next lint` in auth-web/
- **Naming**:
  - PascalCase for components, interfaces, type aliases
  - camelCase for variables, functions, properties
  - UPPER_SNAKE_CASE for constants
- **Imports**: Group by external → internal → relative; sort alphabetically within groups
- **IPC Channels**: Use `kebab-case` with domain prefix (e.g., `env:`, `gateway:`, `auth:`)
- **CSS**: Tailwind CSS with CSS variables for theming; dark mode via `darkMode: ["class"]`

### Commit Message Template

> TODO: Define commit message convention (e.g., Conventional Commits)

---

## Architecture Notes

### High-Level Data Flow

**Windows (WSL2 flow):**

```
┌─────────────────┐     IPC      ┌──────────────────┐
│  React Renderer │◄────────────►│  Electron Main   │
│  (renderer-react)│             │   (main.ts)      │
└─────────────────┘              └────────┬─────────┘
                                        │
                                        │ spawn / WSL
                                        ▼
                               ┌──────────────────┐
                               │   WSL2 Ubuntu    │
                               │  Node.js Runtime │
                               └────────┬─────────┘
                                        │
                                        │ npm -g openclaw
                                        ▼
                               ┌──────────────────┐
                               │  OpenClaw CLI    │
                               │  Gateway Service │
                               └──────────────────┘
```

**macOS (local runtime flow):**

```
┌─────────────────┐     IPC      ┌──────────────────┐
│  React Renderer │◄────────────►│  Electron Main   │
│  (renderer-react)│             │   (main.ts)      │
└─────────────────┘              └────────┬─────────┘
                                        │
                                        │ spawn
                                        ▼
                               ┌──────────────────┐
                               │  macOS Runtime   │
                               │  Node.js + npm   │
                               └────────┬─────────┘
                                        │
                                        │ npm -g openclaw
                                        ▼
                               ┌──────────────────┐
                               │  OpenClaw CLI    │
                               │  Gateway Service │
                               └──────────────────┘
```

### Major Components

1. **Main Process (`src/main/main.ts`)**: Manages window lifecycle, system tray, protocol handlers (deep links), and orchestrates all background services.

2. **Environment Service (`src/main/services/environment.ts`)**: Abstracts WSL2 interactions—checks prerequisites, installs Node.js/runtime, manages OpenClaw installation, controls gateway lifecycle.

3. **Setup Orchestrator (`src/main/services/setup-orchestrator.ts`)**: Stateful guided setup—tracks progress through stages (WSL → runtime → OpenClaw → onboarding), emits events to UI.

4. **Config Store (`src/main/services/config-store.ts`)**: JSON file-based user configuration persisted in `userData`.

5. **Auto Updater (`src/main/services/auto-updater.ts`)**: Checks for updates via electron-updater, downloads in background, notifies UI.

6. **React Renderer**: SPA with React Router, uses IPC via `window.electronAPI` (exposed in preload) to call main process handlers.

7. **Auth Web**: Separate Next.js deployment handling authentication via Clerk, desktop handoff tokens, and billing (Polar integration).

---

## Testing Strategy

### Unit Tests

- **Runner**: Node.js built-in test runner (`node --test`)
- **Location**: `tests/*.test.js`
- **Build Step**: Tests require compiled JS in `dist/`

```bash
npm test  # builds main, then runs tests
```

### Test Files

- `tests/parsers.test.js` — Output parsers for gateway status, channel status, model status
- `tests/setup-orchestrator.test.js` — Setup state machine
- `tests/setup-store.test.js` — Setup persistence
- `tests/environment.test.js` — Environment checks

### E2E / Integration

> TODO: No Playwright/Cypress configured yet. Manual testing on Windows 10/11 VMs.

### CI Testing

GitHub Actions runs on tag push only (release builds). No automated test gate in CI yet.

---

## Security & Compliance

### Secrets Handling

- API keys (model providers) stored in plain JSON config currently
- > TODO: Migrate to Windows Credential Manager or OS keychain
- Auth tokens exchanged via short-lived handoff tokens (auth-web → desktop)

### Dependency Scanning

> TODO: Add `npm audit` to CI or integrate Dependabot

### Electron Security

- `contextIsolation: true` — Preload runs in isolated world
- `nodeIntegration: false` — Renderer cannot access Node APIs directly
- IPC uses explicit allowlist via `ipcMain.handle` registrations
- External links open in system browser (`shell.openExternal`)
- CSP headers should be reviewed for renderer content

### License

- **License**: AGPL-3.0-or-later
- Compliance: Any network use requires source availability

---

## Agent Guardrails

### Files Never Touch Without Human Review

- `LICENSE` — Legal text
- `assets/branding/*` — Trademarked logos and icons
- `.github/workflows/build-release.yml` — Release pipeline (critical path)

### Required Reviews

- Changes to IPC surface (`ipcMain.handle` registrations in `main.ts`)
- Changes to WSL command execution (security boundary)
- Changes to auto-updater logic (risk of bricking installs)

### Rate Limits / Automation Boundaries

- Do not auto-generate new IPC channels without type updates in `src/shared/types.ts`
- Do not modify `package.json` `build` config (electron-builder) without testing artifact output
- Avoid auto-changing Tailwind theme colors (brand identity)

---

## Extensibility Hooks

### Environment Variables

| Variable | Purpose |
|----------|---------|
| `OPENCLAW_UI_EXPERIMENT` | Set to `legacy` to use vanilla renderer; defaults to react |
| `OPENCLAW_AUTH_WEB_BASE_URL` | Override auth web base URL (default: https://auth.openclawdesk.top) |
| `NODE_ENV` | Standard Node environment |

### Feature Flags

- UI experiment flag: `process.env.OPENCLAW_UI_EXPERIMENT` in `main.ts`
- Auto-start gateway: `config.autoStartGateway` (user preference)

### Plugin Points

- **Gateway RPC**: Add new `gateway:call` methods by extending `environment.ts`
- **Workspace Files**: Edit `WorkspaceEditableFileName` union in `types.ts` to add new editable files
- **Wizard Steps**: Extend `WizardStepType` and handlers in `environment.ts`

---

## Further Reading

- `docs/OPENCLAW_DESKTOP_PRODUCT_MEMORY.md` — Product goals, UX rules, architecture decisions
- `docs/FREE_TRIAL_SUBSCRIPTION_BACKLOG.md` — Billing/subscription roadmap
- `docs/WINDOWS_TEST_MATRIX.md` — VM test configurations
- `README.md` — Quick start and download links
- `LICENSE` — Full AGPL-3.0 text

> TODO: Create `docs/ARCH.md` for deeper technical architecture documentation
