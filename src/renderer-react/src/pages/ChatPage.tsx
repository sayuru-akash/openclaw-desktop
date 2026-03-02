import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, Plus, Send, Square } from "lucide-react";
import { GatewayGuard } from "../components/GatewayGuard";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { ScrollArea } from "../components/ui/scroll-area";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";
import { createRequestId, logError, logInfo } from "../lib/logger";

interface ChatPageProps {
  gatewayRunning: boolean;
  isBusy: boolean;
  detecting?: boolean;
  startingUp?: boolean;
  onStartGateway: () => void;
}

interface SessionOption {
  key: string;
  label: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  pending?: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getStringField(record: Record<string, unknown>, keys: string[]): string {
  for (const k of keys) {
    const value = record[k];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return "";
}

function normalizeSessions(payload: unknown): SessionOption[] {
  const root = asRecord(payload);
  const listRaw = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.sessions)
      ? root.sessions
      : Array.isArray(root?.items)
        ? root.items
        : [];

  return listRaw
    .map((entry, index) => {
      const item = asRecord(entry) ?? {};
      const key = getStringField(item, ["key", "sessionKey", "id", "sessionId"]) || `session-${index + 1}`;
      const created = getStringField(item, ["createdAt", "created", "created_at"]);
      return {
        key,
        label: created ? `${key} (${created})` : key
      };
    })
    .filter((item) => item.key);
}

function extractContentText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value
      .map((block) => {
        if (typeof block === "string") return block;
        const b = asRecord(block);
        if (!b) return "";
        const blockType = typeof b.type === "string" ? b.type.toLowerCase() : "";
        if (blockType === "thinking") return "";
        return (typeof b.text === "string" ? b.text : "")
          || (typeof b.content === "string" ? b.content : "");
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function normalizeMessages(payload: unknown): ChatMessage[] {
  const root = asRecord(payload);
  const listRaw = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.messages)
      ? root.messages
      : Array.isArray(root?.history)
        ? root.history
        : [];

  return listRaw
    .map((entry, index) => {
      const item = asRecord(entry) ?? {};
      const roleRaw = getStringField(item, ["role", "speaker", "type"]).toLowerCase();
      const role = roleRaw === "user" ? "user" : "assistant";
      // content can be a string OR an array of content blocks [{type:"text",text:"..."}]
      const content = extractContentText(item.content)
        || getStringField(item, ["message", "text", "response"]);
      return {
        id: `history-${index}-${Math.random().toString(36).slice(2, 8)}`,
        role,
        content: content.trim()
      };
    })
    .filter((message) => message.role === "user" || message.content.length > 0);
}

function extractReply(payload: unknown): string {
  if (typeof payload === "string") {
    return payload;
  }
  const root = asRecord(payload);
  if (!root) {
    return JSON.stringify(payload);
  }

  return (
    getStringField(root, ["reply", "response", "message", "text", "content"])
    || getStringField(asRecord(root.result) ?? {}, ["reply", "response", "message", "text", "content"])
    || JSON.stringify(payload, null, 2)
  );
}

function extractSessionKey(payload: unknown): string {
  const root = asRecord(payload);
  if (!root) {
    return "";
  }
  return (
    getStringField(root, ["sessionKey", "key", "sessionId", "id"])
    || getStringField(asRecord(root.result) ?? {}, ["sessionKey", "key", "sessionId", "id"])
  );
}

function makeIdempotencyKey(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function ChatPage({ gatewayRunning, isBusy, detecting = false, startingUp = false, onStartGateway }: ChatPageProps) {
  const [sessions, setSessions] = useState<SessionOption[]>([]);
  const [sessionKey, setSessionKey] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState("");
  const [loadingHistory, setLoadingHistory] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const messagesRef = useRef<ChatMessage[]>([]);

  const stopElapsedTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const loadSessions = useCallback(async () => {
    const requestId = createRequestId("chat");
    logInfo({ area: "chat", event: "sessions:start", requestId });
    const payload = await window.openclaw.gatewayCall("sessions.list", {});
    const next = normalizeSessions(payload);
    setSessions(next);
    if (!sessionKey && next.length > 0) {
      setSessionKey(next[0].key);
    }
    logInfo({ area: "chat", event: "sessions:success", requestId, details: { count: next.length } });
  }, [sessionKey]);

  const loadHistory = useCallback(async (key: string) => {
    if (!key) {
      setMessages([]);
      return;
    }

    const requestId = createRequestId("chat");
    logInfo({ area: "chat", event: "history:start", requestId, details: { key } });
    setLoadingHistory(true);
    try {
      const payload = await window.openclaw.gatewayCall("chat.history", { sessionKey: key });
      setMessages(normalizeMessages(payload));
      setError("");
      logInfo({ area: "chat", event: "history:success", requestId, details: { key } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError({ area: "chat", event: "history:error", requestId, details: { key, message } });
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  const sendMessage = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) {
      return;
    }

    const requestId = createRequestId("chat");
    logInfo({ area: "chat", event: "send:start", requestId, details: { sessionKey: sessionKey || "<new>" } });
    const baselineAssistantCount = messagesRef.current.filter((message) => message.role === "assistant" && !message.pending).length;
    const userId = `user-${Date.now()}`;
    const pendingId = `assistant-pending-${Date.now()}`;
    setMessages((current) => [
      ...current,
      { id: userId, role: "user", content: text },
      { id: pendingId, role: "assistant", content: "Thinking...", pending: true }
    ]);
    setInput("");
    setSending(true);
    setElapsed(0);
    stopElapsedTimer();
    timerRef.current = setInterval(() => {
      setElapsed((current) => current + 1);
    }, 1000);
    setError("");

    try {
      // sessionKey is always required by the gateway. If none is selected
      // (new conversation), generate one so the gateway creates the session.
      const activeKey = sessionKey || `session-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      if (!sessionKey) {
        setSessionKey(activeKey);
      }

      const params: Record<string, string> = {
        sessionKey: activeKey,
        message: text,
        idempotencyKey: makeIdempotencyKey()
      };

      const result = await window.openclaw.gatewayCall("chat.send", params);
      console.info("[ChatPage] chat.send result:", JSON.stringify(result).slice(0, 500));

      // chat.send returns {runId, status:"started"} — the actual reply is in the history.
      // Load history to get the full conversation including the model's response.
      const maxPollAttempts = 20;
      const pollDelayMs = 1200;
      let historyMessages: ChatMessage[] = [];
      let replyReceived = false;
      for (let attempt = 0; attempt < maxPollAttempts; attempt += 1) {
        const historyPayload = await window.openclaw.gatewayCall("chat.history", { sessionKey: activeKey });
        historyMessages = normalizeMessages(historyPayload);
        if (historyMessages.length > 0) {
          setMessages(historyMessages);
        }
        const assistantCount = historyMessages.filter((message) => message.role === "assistant").length;
        if (assistantCount > baselineAssistantCount) {
          replyReceived = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, pollDelayMs));
      }
      if (historyMessages.length > 0) {
        setMessages(historyMessages);
        if (!replyReceived) {
          setError("Model run started, but no visible assistant text reply arrived yet. Try again in a few seconds.");
        }
      } else {
        // Fallback: try to extract reply from the send result directly
        const reply = extractReply(result);
        setMessages((current) =>
          current.map((msg) => (msg.id === pendingId ? { ...msg, content: reply, pending: false } : msg))
        );
      }

      const maybeKey = extractSessionKey(result);
      if (maybeKey && maybeKey !== activeKey) {
        setSessionKey(maybeKey);
      }
      await loadSessions();
      logInfo({ area: "chat", event: "send:success", requestId, details: { sessionKey: sessionKey || "<new>" } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setMessages((current) => current.filter((msg) => msg.id !== pendingId));
      logError({ area: "chat", event: "send:error", requestId, details: { sessionKey: sessionKey || "<new>", message } });
    } finally {
      stopElapsedTimer();
      setSending(false);
      setElapsed(0);
    }
  }, [input, loadSessions, sending, sessionKey, stopElapsedTimer]);

  const abortSend = useCallback(async () => {
    if (!sessionKey) {
      return;
    }
    const requestId = createRequestId("chat");
    logInfo({ area: "chat", event: "abort:start", requestId, details: { sessionKey } });
    try {
      await window.openclaw.gatewayCall("chat.abort", { sessionKey });
      setMessages((current) => current.filter((msg) => !msg.pending));
      logInfo({ area: "chat", event: "abort:success", requestId, details: { sessionKey } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError({ area: "chat", event: "abort:error", requestId, details: { sessionKey, message } });
    } finally {
      stopElapsedTimer();
      setSending(false);
      setElapsed(0);
    }
  }, [sessionKey, stopElapsedTimer]);

  useEffect(() => {
    if (!gatewayRunning) {
      setSessions([]);
      setSessionKey("");
      setMessages([]);
      setError("");
      setSending(false);
      setElapsed(0);
      stopElapsedTimer();
      return;
    }

    void loadSessions().catch((err) => {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
    });
  }, [gatewayRunning, loadSessions, stopElapsedTimer]);

  useEffect(() => {
    if (!gatewayRunning || !sessionKey || sending) {
      return;
    }
    void loadHistory(sessionKey);
  }, [gatewayRunning, loadHistory, sending, sessionKey]);

  useEffect(() => {
    messagesRef.current = messages;
  }, [messages]);

  useEffect(() => {
    const node = listRef.current;
    if (!node) {
      return;
    }
    node.scrollTop = node.scrollHeight;
  }, [messages]);

  useEffect(() => {
    return () => {
      stopElapsedTimer();
    };
  }, [stopElapsedTimer]);

  const disableActions = isBusy || loadingHistory;
  const hasMessages = useMemo(() => messages.length > 0, [messages.length]);

  return (
    <GatewayGuard gatewayRunning={gatewayRunning} onStartGateway={onStartGateway} isBusy={isBusy} detecting={detecting} startingUp={startingUp}>
      <Card className="h-full">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>Chat</CardTitle>
            <div className="flex items-center gap-2">
              <Select value={sessionKey} onChange={(event) => setSessionKey(event.target.value)} disabled={disableActions || sessions.length === 0}>
                {sessions.length === 0 ? <option value="">No sessions</option> : null}
                {sessions.map((session) => (
                  <option key={session.key} value={session.key}>{session.label}</option>
                ))}
              </Select>
              <Button
                variant="outline"
                onClick={() => {
                  setSessionKey("");
                  setMessages([]);
                }}
                disabled={disableActions}
              >
                <Plus className="h-4 w-4" />
                New Session
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex h-[calc(100%-5.5rem)] min-h-0 flex-col gap-3">
          {error ? <p className="text-xs text-destructive">{error}</p> : null}

          <ScrollArea className="min-h-0 flex-1 rounded-md border border-border bg-muted/20 p-3">
            <div ref={listRef} className="space-y-2">
              {!hasMessages ? (
                <p className="text-sm text-muted-foreground">No messages yet.</p>
              ) : messages.map((message) => (
                <div key={message.id} className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={[
                      "max-w-[85%] rounded-md px-3 py-2 text-sm whitespace-pre-wrap",
                      message.role === "user"
                        ? "bg-primary text-primary-foreground"
                        : "bg-muted text-foreground"
                    ].join(" ")}
                  >
                    {message.content}
                    {message.pending ? (
                      <span className="ml-2 inline-flex items-center gap-1 align-middle text-xs text-muted-foreground">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {elapsed > 0 ? `${elapsed}s` : "0s"}
                      </span>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>
          </ScrollArea>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Badge variant={sending ? "warning" : "default"}>{sending ? "Sending" : "Idle"}</Badge>
            </div>
            <Textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Type a message..."
              className="min-h-[100px]"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void sendMessage();
                }
              }}
              disabled={disableActions}
            />
            <div className="flex gap-2">
              <Button onClick={() => { void sendMessage(); }} disabled={disableActions || sending || !input.trim()}>
                <Send className="h-4 w-4" />
                Send
              </Button>
              <Button variant="outline" onClick={() => { void abortSend(); }} disabled={disableActions || !sending}>
                <Square className="h-4 w-4" />
                Abort
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </GatewayGuard>
  );
}
