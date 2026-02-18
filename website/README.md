# Website

Static marketing site for OpenClaw Desktop.

## Local preview

Open `/Users/hithesh/Documents/openclaw-desktop/website/index.html` in a browser.

## Download file

The main CTA points to:

`/downloads/OpenClawDesktopSetup.exe`

Place your signed installer at:

`/Users/hithesh/Documents/openclaw-desktop/website/downloads/OpenClawDesktopSetup.exe`

## GitHub Pages deploy

This repo includes:

`/Users/hithesh/Documents/openclaw-desktop/.github/workflows/deploy-pages.yml`

It deploys the `website/` folder to GitHub Pages on push to `main` or `master`.

One-time setup in GitHub:

1. Go to `Settings -> Pages`.
2. Set `Build and deployment -> Source` to `GitHub Actions`.
3. Push to `main` (or run the workflow manually).
