# OpenClaw Desktop
<img width="637" height="200" alt="openclaw_logo" src="https://github.com/user-attachments/assets/69219269-b315-4eac-919a-c5c16e5c7f9b" />



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
