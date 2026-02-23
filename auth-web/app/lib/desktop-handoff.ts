function isValidState(value: string): boolean {
  return /^[a-f0-9]{16,128}$/i.test(value);
}

export function parseDesktopHandoffState(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }
  const value = rawValue.trim();
  return isValidState(value) ? value : null;
}

export function parseDesktopCallbackUrl(rawValue: string | null): string | null {
  if (!rawValue) {
    return null;
  }

  let url: URL;
  try {
    url = new URL(rawValue);
  } catch {
    return null;
  }

  if (url.protocol !== "http:") {
    return null;
  }

  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    return null;
  }

  const port = Number(url.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return null;
  }

  if (url.pathname !== "/callback") {
    return null;
  }

  url.search = "";
  url.hash = "";
  return url.toString();
}

