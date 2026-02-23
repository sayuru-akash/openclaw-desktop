import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

interface DesktopHandoffPayload {
  userId: string;
  state: string;
  exp: number;
  nonce: string;
}

const DESKTOP_HANDOFF_TTL_MS = 2 * 60 * 1000;

function encodeBase64Url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

function decodeBase64Url(input: string): string {
  return Buffer.from(input, "base64url").toString("utf8");
}

function getDesktopHandoffSecret(): string {
  const secret = process.env.CLERK_SECRET_KEY?.trim() || process.env.DESKTOP_HANDOFF_SECRET?.trim();
  if (!secret) {
    throw new Error("Missing desktop handoff secret.");
  }
  return secret;
}

function signPayload(encodedPayload: string): string {
  return encodeBase64Url(
    createHmac("sha256", getDesktopHandoffSecret())
      .update(encodedPayload)
      .digest()
  );
}

export function createDesktopHandoffToken(userId: string, state: string): string {
  const payload: DesktopHandoffPayload = {
    userId,
    state,
    exp: Date.now() + DESKTOP_HANDOFF_TTL_MS,
    nonce: randomBytes(12).toString("hex")
  };

  const encodedPayload = encodeBase64Url(JSON.stringify(payload));
  const signature = signPayload(encodedPayload);
  return `${encodedPayload}.${signature}`;
}

export function verifyDesktopHandoffToken(token: string, expectedState: string): { ok: true; userId: string } | { ok: false; error: string } {
  const [encodedPayload, signature] = token.split(".");

  if (!encodedPayload || !signature) {
    return { ok: false, error: "Invalid handoff token." };
  }

  const expectedSignature = signPayload(encodedPayload);
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expectedSignature);

  if (actualBytes.length !== expectedBytes.length || !timingSafeEqual(actualBytes, expectedBytes)) {
    return { ok: false, error: "Invalid handoff signature." };
  }

  let payload: DesktopHandoffPayload;
  try {
    payload = JSON.parse(decodeBase64Url(encodedPayload)) as DesktopHandoffPayload;
  } catch {
    return { ok: false, error: "Invalid handoff payload." };
  }

  if (!payload.userId || !payload.state || !payload.exp) {
    return { ok: false, error: "Malformed handoff payload." };
  }

  if (payload.state !== expectedState) {
    return { ok: false, error: "State mismatch. Start sign-in again." };
  }

  if (payload.exp <= Date.now()) {
    return { ok: false, error: "Handoff token expired. Start sign-in again." };
  }

  return { ok: true, userId: payload.userId };
}

