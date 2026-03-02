import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { GatewayGuard } from "../components/GatewayGuard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { createRequestId, logError, logInfo } from "../lib/logger";

interface SessionsPageProps {
  gatewayRunning: boolean;
  isBusy: boolean;
  detecting?: boolean;
  startingUp?: boolean;
  onStartGateway: () => void;
}

interface SessionRow {
  key: string;
  created: string;
  lastActive: string;
  messageCount: string;
  raw: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getStringField(record: Record<string, unknown>, keys: string[], fallback = "n/a"): string {
  for (const k of keys) {
    const value = record[k];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return fallback;
}

function toSessionRows(payload: unknown): SessionRow[] {
  const root = asRecord(payload);
  const listRaw = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.sessions)
      ? root.sessions
      : Array.isArray(root?.items)
        ? root.items
        : [];

  return listRaw.map((entry, index) => {
    const item = asRecord(entry) ?? {};
    return {
      key: getStringField(item, ["key", "sessionKey", "id", "sessionId"], `session-${index + 1}`),
      created: getStringField(item, ["createdAt", "created", "created_at"]),
      lastActive: getStringField(item, ["lastActiveAt", "lastActive", "updatedAt", "updated_at"]),
      messageCount: getStringField(item, ["messageCount", "messages", "message_count"], "0"),
      raw: entry
    };
  });
}

export function SessionsPage({ gatewayRunning, isBusy, detecting = false, startingUp = false, onStartGateway }: SessionsPageProps) {
  const [rows, setRows] = useState<SessionRow[]>([]);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState("");
  const [busySessionKey, setBusySessionKey] = useState("");
  const [loading, setLoading] = useState(false);

  const loadSessions = useCallback(async () => {
    if (!gatewayRunning) {
      return;
    }

    const requestId = createRequestId("sessions");
    logInfo({ area: "sessions", event: "list:start", requestId });
    setLoading(true);
    try {
      const payload = await window.openclaw.gatewayCall("sessions.list", {});
      setRows(toSessionRows(payload));
      setError("");
      logInfo({ area: "sessions", event: "list:success", requestId, details: { count: toSessionRows(payload).length } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError({ area: "sessions", event: "list:error", requestId, details: { message } });
    } finally {
      setLoading(false);
    }
  }, [gatewayRunning]);

  const runRowAction = useCallback(async (method: string, key: string) => {
    const requestId = createRequestId("sessions");
    logInfo({ area: "sessions", event: "action:start", requestId, details: { method, key } });
    setBusySessionKey(key);
    setError("");
    try {
      const result = await window.openclaw.gatewayCall(method, { key });
      if (method === "sessions.preview") {
        const text = typeof result === "string" ? result : JSON.stringify(result, null, 2);
        setPreview(text);
      } else {
        await loadSessions();
      }
      logInfo({ area: "sessions", event: "action:success", requestId, details: { method, key } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError({ area: "sessions", event: "action:error", requestId, details: { method, key, message } });
    } finally {
      setBusySessionKey("");
    }
  }, [loadSessions]);

  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const hasRows = useMemo(() => rows.length > 0, [rows.length]);

  return (
    <GatewayGuard gatewayRunning={gatewayRunning} onStartGateway={onStartGateway} isBusy={isBusy} detecting={detecting} startingUp={startingUp}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Sessions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-2">
              <Button onClick={loadSessions} disabled={isBusy || loading}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Key</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead>Last Active</TableHead>
                  <TableHead>Message Count</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hasRows ? rows.map((row) => (
                  <TableRow key={row.key}>
                    <TableCell>{row.key}</TableCell>
                    <TableCell>{row.created}</TableCell>
                    <TableCell>{row.lastActive}</TableCell>
                    <TableCell>{row.messageCount}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => { void runRowAction("sessions.preview", row.key); }} disabled={isBusy || busySessionKey === row.key}>Preview</Button>
                        <Button variant="outline" onClick={() => { void runRowAction("sessions.reset", row.key); }} disabled={isBusy || busySessionKey === row.key}>Reset</Button>
                        <Button variant="outline" onClick={() => { void runRowAction("sessions.compact", row.key); }} disabled={isBusy || busySessionKey === row.key}>Compact</Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            if (window.confirm(`Delete session ${row.key}?`)) {
                              void runRowAction("sessions.delete", row.key);
                            }
                          }}
                          disabled={isBusy || busySessionKey === row.key}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">No sessions found.</TableCell>
                    <TableCell className="hidden" />
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </CardContent>
        </Card>

        {preview ? (
          <Card>
            <CardHeader>
              <CardTitle>Session Preview</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="max-h-80 overflow-auto rounded-sm border border-border bg-[#141414] p-3 text-[11px] leading-5 text-muted-foreground">
                {preview}
              </pre>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </GatewayGuard>
  );
}
