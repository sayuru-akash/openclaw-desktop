export default async function handler(req, res) {
  try {
    const response = await fetch(
      "https://api.github.com/repos/hith3sh/openclaw-desktop/releases/latest",
      { headers: { Accept: "application/vnd.github+json" } }
    );

    if (!response.ok) {
      return res.redirect(302, "https://github.com/hith3sh/openclaw-desktop/releases/latest");
    }

    const release = await response.json();
    const exe = release.assets?.find((a) => a.name.endsWith(".exe"));

    if (!exe) {
      return res.redirect(302, release.html_url);
    }

    return res.redirect(302, exe.browser_download_url);
  } catch {
    return res.redirect(302, "https://github.com/hith3sh/openclaw-desktop/releases/latest");
  }
}
