import { NextResponse } from "next/server";
import { verifyDesktopHandoffToken } from "../../../../lib/desktop-handoff-token";
import { parseDesktopHandoffState } from "../../../../lib/desktop-handoff";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = await request.json().catch(() => ({})) as { token?: unknown; state?: unknown };
  const token = typeof body.token === "string" ? body.token.trim() : "";
  const state = parseDesktopHandoffState(typeof body.state === "string" ? body.state : null);

  if (!token || !state) {
    return NextResponse.json(
      { authenticated: false, error: "Invalid token exchange payload." },
      { status: 400 }
    );
  }

  const result = verifyDesktopHandoffToken(token, state);
  if (!result.ok) {
    return NextResponse.json(
      { authenticated: false, error: result.error },
      { status: 400 }
    );
  }

  return NextResponse.json({
    authenticated: true,
    userId: result.userId
  });
}
