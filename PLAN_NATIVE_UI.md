# Plan: Replace Embedded Gateway WebView with Native React Pages

## Context

The desktop app currently embeds the OpenClaw gateway web UI (`http://127.0.0.1:18789/`) via Electron `<webview>` elements for Chat and Control workspaces. This causes issues: ERR_CONNECTION_REFUSED errors, black screens when gateway is down, fragile JavaScript injection for tab selection, and a poor UX overall. The goal is to **remove all webview embedding** and build native React pages that talk directly to the gateway's RPC API, giving us full control over the UI.

The gateway exposes a WebSocket RPC protocol with 50+ methods. These are accessible via CLI: `openclaw gateway call [method] --params '[json]' --json`. The existing wizard code already uses this pattern successfully.

---

## Navigation Restructure

**Remove** the `Workspace` concept (`"chat" | "setup" | "control"`) and the separate `FeaturePane` type. Replace with a single flat `Page` type:

```ts
type Page =
  | "chat"        // Native chat interface (replaces webview)
  | "overview"    // Dashboard / gateway health (replaces webview)
  | "channels"    // Channel management (enhanced from existing pane)
  | "sessions"    // Session list + management (new)
  | "cron"        // Cron job management (new)
  | "models"      // Model config (extracted from existing pane)
  | "files"       // File editor (extracted from existing pane)
  | "settings"    // Settings (extracted from existing pane)
  | "updates"     // App updates (extracted from existing pane)
  | "logs";       // Log viewer (extracted from existing pane)
```

**Sidebar** becomes two groups:
- **Main**: Chat, Overview
- **Manage**: Channels, Sessions, Cron, Models, Files, Settings, Updates, Logs

Onboarding wizard remains a full-screen takeover (unchanged). Right sidebar (Quick Actions) stays unchanged.

---

## Phase 1: Infrastructure

### 1.1 Generic `gatewayCall` IPC bridge

Status: ✅ Completed (March 2, 2026)

Promote the existing private `runWizardCall` (environment.ts:1373) to a public method.

**`src/main/services/environment.ts`** — Make `runWizardCall` public as `gatewayCall`:
```ts
public async gatewayCall<T>(method: string, params: unknown = {}): Promise<T> {
  const payload = JSON.stringify(params);
  const result = await this.runOpenClaw(["gateway", "call", method, "--params", payload, "--json"]);

  if (!result.ok) {
    throw new Error(result.stderr || result.stdout || `${method} failed`);
  }

  const parsed = this.parseJsonOutput(result.stdout, result.stderr);
  if (parsed && typeof parsed === "object" && "error" in parsed) {
    const errorValue = (parsed as { error?: unknown }).error;
    if (errorValue) {
      throw new Error(typeof errorValue === "string" ? errorValue : JSON.stringify(errorValue));
    }
  }

  if (parsed && typeof parsed === "object" && "result" in parsed) {
    return (parsed as { result: T }).result;
  }

  return parsed as T;
}
```

Keep `runWizardCall` as a private wrapper calling `gatewayCall` for backward compat.

**`src/main/main.ts`** — Add IPC handler:
```ts
ipcMain.handle("gateway:call", (_event, method: string, params: unknown) =>
  environmentService.gatewayCall(method, params)
);
```

**`src/preload/preload.ts`** — Add to api object:
```ts
gatewayCall: (method: string, params?: unknown) =>
  ipcRenderer.invoke("gateway:call", method, params ?? {}),
```

**`src/shared/types.ts`** — Add to `RendererApi`:
```ts
gatewayCall: <T = unknown>(method: string, params?: unknown) => Promise<T>;
```

### 1.2 GatewayGuard component

Status: ✅ Completed (March 2, 2026)

**New `src/renderer-react/src/components/GatewayGuard.tsx`** — Wrapper that shows "Gateway Not Running" + Start button if gateway is down. All gateway-dependent pages use this:
```tsx
export function GatewayGuard({ gatewayRunning, onStartGateway, isBusy, children }) {
  if (!gatewayRunning) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <p className="text-sm text-muted-foreground">Gateway is not running.</p>
          <Button onClick={onStartGateway} disabled={isBusy}>
            <Play className="h-4 w-4" /> Start Gateway
          </Button>
        </CardContent>
      </Card>
    );
  }
  return <>{children}</>;
}
```

### 1.3 Navigation restructure in App.tsx

Status: ✅ Completed (March 2, 2026)

**Remove:**
- `Workspace` type, `workspace` state, `openWorkspace()` function
- `CONTROL_UI_URL` constant
- `chatWebviewRef`, `controlWebviewRef` refs
- `gatewayHttpReady`, `chatStatusText`, `chatFallbackVisible`, `controlStatusText`, `controlFallbackVisible` states
- `ensureChatTabSelected` callback + timer refs
- `updateChatSurface`, `updateControlSurface` callbacks
- All webview `useEffect` hooks
- `renderWebviewWorkspace()` function

**Replace with:**
- Single `page` state: `const [page, setPage] = useState<Page>("overview")`
- Updated sidebar with two groups (Main: Chat, Overview / Manage: Channels, Sessions, Cron, Models, Files, Settings, Updates, Logs)
- Switch on `page` in content area to render page components

**Keep in App.tsx:** onboarding wizard, global state, action handlers, right sidebar

### 1.4 Extract existing panes into page files

Status: ✅ Completed (March 2, 2026)

Mechanical extraction — move existing render functions to separate files, accept props:

| Existing function | New file |
|---|---|
| `renderChannelsPane()` | `src/renderer-react/src/pages/ChannelsPage.tsx` |
| `renderModelsPane()` | `src/renderer-react/src/pages/ModelsPage.tsx` |
| `renderFilesPane()` | `src/renderer-react/src/pages/FilesPage.tsx` |
| `renderSettingsPane()` | `src/renderer-react/src/pages/SettingsPage.tsx` |
| `renderUpdatesPane()` | `src/renderer-react/src/pages/UpdatesPage.tsx` |
| `renderLogsPane()` | `src/renderer-react/src/pages/LogsPage.tsx` |

Each page receives needed state and callbacks via props.

---

## Phase 2: New Data Pages

All new pages follow the same pattern: call `window.openclaw.gatewayCall(method, params)`, render results in shadcn Card/Table components, wrap in `GatewayGuard`.

### 2.1 Overview Page (`src/renderer-react/src/pages/OverviewPage.tsx`)
Status: ✅ Completed (March 2, 2026)
- Calls `status` and `health` gateway RPCs on mount + polling every 10s
- Shows: gateway health, uptime, version, active sessions count, connected channels, system notes
- Gateway Start/Stop buttons
- Reuses existing status table pattern

**Gateway RPC methods:** `status`, `health`

### 2.2 Sessions Page (`src/renderer-react/src/pages/SessionsPage.tsx`)
Status: ✅ Completed (March 2, 2026)
- Calls `sessions.list` on mount
- Table: ID, Created, Last Active, Message Count
- Row actions: Preview, Reset, Compact, Delete (each calls corresponding RPC)
- Refresh button

**Gateway RPC methods:** `sessions.list`, `sessions.patch`, `sessions.delete`, `sessions.preview`, `sessions.reset`, `sessions.compact`

### 2.3 Cron Page (`src/renderer-react/src/pages/CronPage.tsx`)
Status: ✅ Completed (March 2, 2026)
- Calls `cron.list` on mount
- Table: Name, Schedule, Last Run, Status
- Row actions: Run Now, Edit, Remove
- Add Job form (name, schedule, command)
- Run history via `cron.runs`

**Gateway RPC methods:** `cron.list`, `cron.status`, `cron.add`, `cron.update`, `cron.remove`, `cron.run`, `cron.runs`

---

## Phase 3: Chat Page

### Chat Page (`src/renderer-react/src/pages/ChatPage.tsx`)
Status: ✅ Completed (March 2, 2026)

**Non-streaming MVP** (CLI `gateway call` returns full response, no streaming):

**State:**
```ts
const [messages, setMessages] = useState<ChatMessage[]>([]);
const [input, setInput] = useState("");
const [sending, setSending] = useState(false);
const [sessionId, setSessionId] = useState<string | null>(null);
```

**Layout:**
- Message list (ScrollArea, auto-scroll to bottom)
- Fixed input area at bottom (Textarea + Send button + Abort button)
- Header: session selector dropdown, New Session button

**Flow:**
1. On mount: `sessions.list` → load most recent → `chat.history` → populate messages
2. Send: append user message optimistically, show "Thinking..." indicator with elapsed timer, call `chat.send`, replace with actual response
3. Abort: call `chat.abort`, remove thinking indicator
4. New session: clear messages, reset session ID

**Message rendering:**
- Plain text with `white-space: pre-wrap` for MVP
- User messages: right-aligned, colored background
- Assistant messages: left-aligned, muted background
- Textarea: Enter to send, Shift+Enter for newline

**Gateway RPC methods:** `chat.history`, `chat.send`, `chat.abort`, `chat.inject`

---

## Files Summary

### New files to create:
| File | Purpose |
|---|---|
| `src/renderer-react/src/components/GatewayGuard.tsx` | Guard wrapper for gateway-dependent pages |
| `src/renderer-react/src/pages/ChatPage.tsx` | Native chat interface |
| `src/renderer-react/src/pages/OverviewPage.tsx` | Gateway dashboard |
| `src/renderer-react/src/pages/ChannelsPage.tsx` | Channel management (extracted + enhanced) |
| `src/renderer-react/src/pages/SessionsPage.tsx` | Session management |
| `src/renderer-react/src/pages/CronPage.tsx` | Cron job management |
| `src/renderer-react/src/pages/ModelsPage.tsx` | Model config (extracted) |
| `src/renderer-react/src/pages/FilesPage.tsx` | File editor (extracted) |
| `src/renderer-react/src/pages/SettingsPage.tsx` | Settings (extracted) |
| `src/renderer-react/src/pages/UpdatesPage.tsx` | Updates (extracted) |
| `src/renderer-react/src/pages/LogsPage.tsx` | Log viewer (extracted) |

### Files to modify:
| File | Changes |
|---|---|
| `src/shared/types.ts` | Add `gatewayCall` to `RendererApi` |
| `src/main/services/environment.ts` | Make `runWizardCall` public as `gatewayCall` |
| `src/main/main.ts` | Add `gateway:call` IPC handler, remove `webviewTag: true` |
| `src/preload/preload.ts` | Add `gatewayCall` to api object |
| `src/renderer-react/src/App.tsx` | Remove webview code, restructure navigation, import pages |

---

## Implementation Order

1. ✅ **gatewayCall IPC bridge** (environment.ts, main.ts, preload.ts, types.ts)
2. ✅ **GatewayGuard** component
3. ✅ **Extract existing panes** into page files (Models, Files, Settings, Updates, Logs, Channels)
4. ✅ **Restructure App.tsx** navigation (remove webviews, flat Page type, import pages)
5. ✅ **OverviewPage** (validates gateway RPC works end-to-end)
6. ✅ **SessionsPage**
7. ✅ **CronPage**
8. ✅ **ChatPage** (most complex)
9. ✅ Remove `webviewTag: true` from main.ts BrowserWindow

---

## Verification

1. `npx tsc --noEmit` — type check
2. `npm run build` — full build
3. Run app — all sidebar items navigate correctly, no webview errors
4. Start gateway → Overview shows health data
5. Sessions/Cron pages load data from gateway
6. Chat page: send message, receive response, abort works

---

## Post-Plan Follow-Up

### Always-on gateway backend upgrade
Status: Completed (March 2, 2026)

- Windows always-on now uses a systemd-first strategy in WSL when available.
- App provisions and enables a WSL user unit: `openclaw-gateway.service`.
- If WSL systemd is unavailable/unusable, it falls back to Windows Task Scheduler.
- Disable flow now turns off both systemd user service (best-effort) and scheduled task.
