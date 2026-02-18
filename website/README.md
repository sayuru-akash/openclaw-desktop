# Website

Static marketing site for OpenClaw Desktop.

## Local preview

Open `/Users/hithesh/Documents/openclaw-desktop/website/index.html` in a browser.

## Polar paywall setup

The website now uses a Polar checkout paywall.

Update `/Users/hithesh/Documents/openclaw-desktop/website/config.js`:

1. Set `polarCheckoutUrl` to your Polar Checkout Link URL.
2. Set `polarPortalUrl` to your Polar customer portal URL.
3. Keep price copy aligned with your Polar product price (`appPriceLabel`).

Example:

`https://polar.sh/your-org/your-checkout-link`

## Installer delivery

Do not expose a direct public `.exe` URL if you want a strict paywall.

Preferred approach:

1. Upload installer as a Polar digital download benefit for the paid product.
2. Let users retrieve the file from Polar's post-purchase flow / customer portal.
3. Configure Polar checkout success redirect back to this site if needed.

## GitHub Pages deploy

This repo includes:

`/Users/hithesh/Documents/openclaw-desktop/.github/workflows/deploy-pages.yml`

It deploys the `website/` folder to GitHub Pages on push to `main` or `master`.

One-time setup in GitHub:

1. Go to `Settings -> Pages`.
2. Set `Build and deployment -> Source` to `GitHub Actions`.
3. Push to `main` (or run the workflow manually).
