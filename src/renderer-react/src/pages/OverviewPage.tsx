import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw, Square } from "lucide-react";
import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { GatewayGuard } from "../components/GatewayGuard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { createRequestId, logError, logInfo } from "../lib/logger";

interface OverviewPageProps {
  gatewayRunning: boolean;
  isBusy: boolean;
  notes: string[];
  detecting?: boolean;
  startingUp?: boolean;
  onStartGateway: () => void;
  onStopGateway: () => void;
}

function formatCompact(value: unknown): string {
  if (value === null || value === undefined) {
    return "n/a";
  }
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function OverviewPage({
  gatewayRunning,
  isBusy,
  notes,
  detecting = false,
  startingUp = false,
  onStartGateway,
  onStopGateway
}: OverviewPageProps) {
  const [statusData, setStatusData] = useState<unknown>(null);
  const [healthData, setHealthData] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [lastUpdated, setLastUpdated] = useState<string | null>(null);

  const refreshGatewayData = useCallback(async () => {
    if (!gatewayRunning) {
      return;
    }

    const requestId = createRequestId("overview");
    logInfo({ area: "overview", event: "refresh:start", requestId });
    setLoading(true);
    try {
      const status = await window.openclaw.gatewayCall("status", {});
      setStatusData(status);
      const health = await window.openclaw.gatewayCall("health", {});
      setHealthData(health);
      setError("");
      setLastUpdated(new Date().toISOString());
      logInfo({ area: "overview", event: "refresh:success", requestId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError({ area: "overview", event: "refresh:error", requestId, details: { message } });
    } finally {
      setLoading(false);
    }
  }, [gatewayRunning]);

  useEffect(() => {
    if (!gatewayRunning) {
      setStatusData(null);
      setHealthData(null);
      setError("");
      setLastUpdated(null);
      return;
    }

    void refreshGatewayData();
    const interval = setInterval(() => {
      void refreshGatewayData();
    }, 10_000);
    return () => {
      clearInterval(interval);
    };
  }, [gatewayRunning, refreshGatewayData]);

  const healthVariant = useMemo(() => {
    if (error) {
      return "danger" as const;
    }
    if (!gatewayRunning) {
      return "warning" as const;
    }
    return "success" as const;
  }, [error, gatewayRunning]);

  return (
    <GatewayGuard gatewayRunning={gatewayRunning} onStartGateway={onStartGateway} isBusy={isBusy} detecting={detecting} startingUp={startingUp}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Gateway Overview</CardTitle>
            <CardDescription>Live gateway RPC health and status.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button onClick={refreshGatewayData} disabled={isBusy || loading}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button variant="outline" onClick={onStopGateway} disabled={isBusy || loading}>
                <Square className="h-4 w-4" />
                Stop Gateway
              </Button>
              <Badge variant={healthVariant}>{error ? "RPC error" : "Gateway running"}</Badge>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Item</TableHead>
                  <TableHead className="text-right">Value</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow>
                  <TableCell>Gateway</TableCell>
                  <TableCell className="text-right">{gatewayRunning ? "Running" : "Stopped"}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Last Updated</TableCell>
                  <TableCell className="text-right">{lastUpdated ? new Date(lastUpdated).toLocaleTimeString() : "n/a"}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Status RPC</TableCell>
                  <TableCell className="text-right">{statusData === null ? "n/a" : "ok"}</TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Health RPC</TableCell>
                  <TableCell className="text-right">{healthData === null ? "n/a" : "ok"}</TableCell>
                </TableRow>
              </TableBody>
            </Table>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Status</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-56 overflow-auto rounded-sm border border-border bg-[#141414] p-3 text-[11px] leading-5 text-muted-foreground">
              {formatCompact(statusData)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Health</CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="max-h-56 overflow-auto rounded-sm border border-border bg-[#141414] p-3 text-[11px] leading-5 text-muted-foreground">
              {formatCompact(healthData)}
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>System Notes</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="space-y-2 text-sm text-muted-foreground">
              {(notes.length > 0 ? notes : ["No notes."]).map((note) => (
                <li key={note}>- {note}</li>
              ))}
            </ul>
          </CardContent>
        </Card>
      </div>
    </GatewayGuard>
  );
}
