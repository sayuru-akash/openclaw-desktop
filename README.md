# OpenClaw Desktop

<img width="400" height="400" alt="openclaw_logo_resized" src="https://github.com/user-attachments/assets/9e80a1a2-d8a1-4a8f-9a71-ff5f7d5d5591" />

Windows-first desktop app for [OpenClaw](https://github.com/openclaw). Install once, follow the guided setup, and start using OpenClaw.

## How it works

1. **Install** — Run the installer for your OS.
2. **Prepare runtime** — Guided setup verifies platform requirements and prepares OpenClaw.
3. **Onboard** — A step-by-step UI walks you through provider, model, and channel (WhatsApp/Telegram) setup.
4. **Run** — The gateway runs in the background with tray controls. Manage channels, models, and workspace files from the app.

## Download

Get the latest installers from [Releases](https://github.com/hith3sh/openclaw-desktop/releases/latest).

**Requirements**

- **Windows:** Windows 10 (build 19041+) or Windows 11 with virtualization enabled.
- **macOS:** macOS 12+ (Intel x64 or Apple Silicon arm64).

## Platform setup behavior

### Windows (fully guided)

- App-guided setup installs and validates: WSL, Ubuntu distro, Node.js, npm, Homebrew, and OpenClaw.
- Setup supports restart/resume and Ubuntu first-run account creation.

### macOS (local runtime flow)

- App-guided setup validates local runtime and installs OpenClaw locally.
- Required runtime dependencies: Node.js and npm.
- Homebrew is detected and shown in status when available, but is not required for onboarding completion.
- There is no WSL flow on macOS.

## Development

```bash
npm install
npm run dev
```

## Production builds

Build Windows NSIS installer (`.exe`):

```bash
npm run dist:win
```

Build macOS installers (`.dmg`, `.pkg`) and archive (`.zip`):

```bash
npm run dist:mac
```

Build all targets from a compatible host/CI runner:

```bash
npm run dist:all
```

Verify generated artifacts in `release/`:

```bash
# auto-detects what was built in release/
npm run verify:artifacts

# or verify platform-specific expectations
npm run verify:artifacts:win
npm run verify:artifacts:mac
```

> Note: Cross-building macOS installers requires a macOS runner. Cross-building Windows NSIS installers requires Windows or compatible wine/nsis setup. The GitHub Actions workflow handles this automatically with per-OS runners.

## CI release pipeline

Tag pushes (`v*`) trigger `.github/workflows/build-release.yml`, which now:

- builds Windows artifacts on `windows-latest`
- builds macOS artifacts (`dmg`, `pkg`, `zip`) on `macos-latest`
- verifies installers + updater metadata exist before publishing
- enforces macOS x64 + arm64 outputs for `dmg`/`pkg`/`zip`
- uploads all produced installers and updater metadata to the GitHub Release

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=hith3sh/openclaw-desktop&type=Date)](https://star-history.com/#hith3sh/openclaw-desktop&Date)

## License

[AGPL-3.0](LICENSE)
