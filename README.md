# OpenClaw Desktop
<img width="400" height="400" alt="openclaw_logo_resized" src="https://github.com/user-attachments/assets/9e80a1a2-d8a1-4a8f-9a71-ff5f7d5d5591" />


Windows-first desktop app for [OpenClaw](https://github.com/openclaw). Install once, follow the guided setup, and start using OpenClaw — no terminal, no manual config files.

## How it works

1. **Install** — Run the `.exe` installer. Guided setup installs WSL + Ubuntu, Node.js, npm, Homebrew, and OpenClaw in WSL.
2. **Onboard** — A step-by-step UI walks you through provider, model, and channel (WhatsApp/Telegram) setup.
3. **Run** — The gateway runs in the background with tray controls. Manage channels, models, and workspace files from the app.

## Download

Get the latest installer from [Releases](https://github.com/hith3sh/openclaw-desktop/releases/latest).

**Requirements:** Windows 10 (build 19041+) or Windows 11 with virtualization enabled.

## Development

```bash
npm install
npm run dev
```

Build Windows installer:

```bash
npm run dist
```

## Star History

[![Star History Chart](https://api.star-history.com/svg?repos=hith3sh/openclaw-desktop&type=Date)](https://star-history.com/#hith3sh/openclaw-desktop&Date)

## License

[AGPL-3.0](LICENSE)
