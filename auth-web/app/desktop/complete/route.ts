import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
import { createDesktopHandoffToken } from "../../lib/desktop-handoff-token";
import { parseDesktopCallbackUrl, parseDesktopHandoffState } from "../../lib/desktop-handoff";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = parseDesktopHandoffState(url.searchParams.get("state"));
  const callback = parseDesktopCallbackUrl(url.searchParams.get("callback"));

  if (!state || !callback) {
    return NextResponse.json(
      { ok: false, error: "Invalid desktop handoff parameters." },
      { status: 400 }
    );
  }

  const { userId } = await auth();
  if (!userId) {
    const signInUrl = new URL("/sign-in", url.origin);
    signInUrl.searchParams.set("redirect_url", url.toString());
    return NextResponse.redirect(signInUrl);
  }

  const token = createDesktopHandoffToken(userId, state);
  const callbackUrl = new URL(callback);
  callbackUrl.searchParams.set("token", token);
  callbackUrl.searchParams.set("state", state);
  const callbackHref = callbackUrl.toString();
  const desktopHref = `openclawdesktop://auth/return?state=${encodeURIComponent(state)}`;
  const safeUserId = userId.replace(/[^a-zA-Z0-9_:@.-]/g, "");

  const html = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <title>Open OpenClaw Desktop</title>
    <style>
      :root { color-scheme: light; }
      body { margin:0; font-family:Inter,Segoe UI,Arial,sans-serif; background:#f6f6f6; color:#101010; }
      .wrap { min-height:100vh; display:grid; place-items:center; padding:24px; }
      .card { width:min(560px,100%); background:#fff; border:1px solid #e5e5e5; border-radius:12px; padding:28px; text-align:center; box-shadow:0 8px 24px rgba(0,0,0,.06); }
      .logo { margin-bottom:8px; }
      .logo img { width:160px; max-width:100%; height:auto; display:block; margin:0 auto; }
      h1 { margin:0; font-size:30px; line-height:1.2; }
      p { margin:12px 0 0; color:#555; }
      .actions { margin-top:22px; display:flex; flex-direction:column; gap:10px; align-items:center; }
      button,a { font:inherit; }
      .primary { border:0; border-radius:10px; padding:12px 18px; background:#111; color:#fff; cursor:pointer; min-width:260px; }
      .secondary { border:1px solid #d8d8d8; border-radius:10px; padding:11px 18px; color:#222; text-decoration:none; background:#fff; min-width:260px; }
      .foot { margin-top:16px; font-size:14px; color:#666; }
      .muted { font-size:13px; margin-top:8px; color:#8a8a8a; }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <div class="logo">
          <img src="/openclaw_logo_light_theme.png" alt="OpenClaw" />
        </div>
        <h1>Continue as ${safeUserId}</h1>
        <p>Open the desktop app to finish sign-in.</p>
        <div class="actions">
          <button class="primary" id="open-app">Open OpenClaw Desktop</button>
          <a class="secondary" href="${callbackHref}" id="continue-browser">Continue in Browser</a>
        </div>
        <p class="foot">If the button does nothing, make sure OpenClaw Desktop is installed.</p>
        <p class="muted">Then click Continue in Browser.</p>
      </section>
    </main>
    <script>
      (function () {
        var openApp = document.getElementById("open-app");
        if (!openApp) return;
        openApp.addEventListener("click", function () {
          window.location.href = ${JSON.stringify(desktopHref)};
          setTimeout(function () {
            window.location.href = ${JSON.stringify(callbackHref)};
          }, 550);
        });
      })();
    </script>
  </body>
</html>`;

  return new NextResponse(html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
