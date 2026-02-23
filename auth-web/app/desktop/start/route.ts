import { auth } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";
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

  const completeUrl = new URL("/desktop/complete", url.origin);
  completeUrl.searchParams.set("state", state);
  completeUrl.searchParams.set("callback", callback);
  return NextResponse.redirect(completeUrl);
}

