import { useCallback, useEffect, useMemo, useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { GatewayGuard } from "../components/GatewayGuard";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../components/ui/table";
import { createRequestId, logError, logInfo } from "../lib/logger";

interface CronPageProps {
  gatewayRunning: boolean;
  isBusy: boolean;
  detecting?: boolean;
  startingUp?: boolean;
  onStartGateway: () => void;
}

interface CronJobRow {
  name: string;
  schedule: string;
  command: string;
  lastRun: string;
  status: string;
}

interface CronRunRow {
  name: string;
  timestamp: string;
  status: string;
  detail: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function getStringField(record: Record<string, unknown>, keys: string[], fallback = "n/a"): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim()) {
      return value;
    }
    if (typeof value === "number") {
      return String(value);
    }
  }
  return fallback;
}

function toJobRows(payload: unknown): CronJobRow[] {
  const root = asRecord(payload);
  const listRaw = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.jobs)
      ? root.jobs
      : Array.isArray(root?.items)
        ? root.items
        : [];

  return listRaw.map((entry) => {
    const item = asRecord(entry) ?? {};
    return {
      name: getStringField(item, ["name", "id"], "unnamed"),
      schedule: getStringField(item, ["schedule", "cron"], "n/a"),
      command: getStringField(item, ["command", "cmd"], "n/a"),
      lastRun: getStringField(item, ["lastRun", "last_run", "lastRunAt"], "n/a"),
      status: getStringField(item, ["status", "state"], "unknown")
    };
  });
}

function toRunRows(payload: unknown): CronRunRow[] {
  const root = asRecord(payload);
  const listRaw = Array.isArray(payload)
    ? payload
    : Array.isArray(root?.runs)
      ? root.runs
      : Array.isArray(root?.items)
        ? root.items
        : [];

  return listRaw.map((entry) => {
    const item = asRecord(entry) ?? {};
    return {
      name: getStringField(item, ["name", "job", "id"], "n/a"),
      timestamp: getStringField(item, ["timestamp", "time", "startedAt", "createdAt"], "n/a"),
      status: getStringField(item, ["status", "state"], "unknown"),
      detail: getStringField(item, ["detail", "message", "result"], "")
    };
  });
}

export function CronPage({ gatewayRunning, isBusy, detecting = false, startingUp = false, onStartGateway }: CronPageProps) {
  const [jobs, setJobs] = useState<CronJobRow[]>([]);
  const [runs, setRuns] = useState<CronRunRow[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeJob, setActiveJob] = useState("");

  const [name, setName] = useState("");
  const [schedule, setSchedule] = useState("");
  const [command, setCommand] = useState("");
  const [editingName, setEditingName] = useState("");

  const refreshCronData = useCallback(async () => {
    if (!gatewayRunning) {
      return;
    }

    const requestId = createRequestId("cron");
    logInfo({ area: "cron", event: "list:start", requestId });
    setLoading(true);
    try {
      const [jobsPayload, runsPayload] = await Promise.all([
        window.openclaw.gatewayCall("cron.list", {}),
        window.openclaw.gatewayCall("cron.runs", {})
      ]);
      const nextJobs = toJobRows(jobsPayload);
      const nextRuns = toRunRows(runsPayload);
      setJobs(nextJobs);
      setRuns(nextRuns);
      setError("");
      logInfo({ area: "cron", event: "list:success", requestId, details: { jobs: nextJobs.length, runs: nextRuns.length } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError({ area: "cron", event: "list:error", requestId, details: { message } });
    } finally {
      setLoading(false);
    }
  }, [gatewayRunning]);

  const callJobMethod = useCallback(async (method: string, jobName: string, extra: Record<string, unknown> = {}) => {
    const payloads = [
      { name: jobName, ...extra },
      { job: jobName, ...extra },
      { id: jobName, ...extra }
    ];

    let lastError: unknown = null;
    for (const params of payloads) {
      try {
        return await window.openclaw.gatewayCall(method, params);
      } catch (err) {
        lastError = err;
      }
    }
    throw (lastError instanceof Error ? lastError : new Error(String(lastError)));
  }, []);

  const runJobAction = useCallback(async (method: string, jobName: string) => {
    const requestId = createRequestId("cron");
    logInfo({ area: "cron", event: "action:start", requestId, details: { method, jobName } });
    setActiveJob(jobName);
    setError("");
    try {
      await callJobMethod(method, jobName);
      await refreshCronData();
      logInfo({ area: "cron", event: "action:success", requestId, details: { method, jobName } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError({ area: "cron", event: "action:error", requestId, details: { method, jobName, message } });
    } finally {
      setActiveJob("");
    }
  }, [callJobMethod, refreshCronData]);

  const submitJob = useCallback(async () => {
    if (!name.trim() || !schedule.trim() || !command.trim()) {
      setError("Name, schedule, and command are required.");
      return;
    }

    const requestId = createRequestId("cron");
    logInfo({
      area: "cron",
      event: editingName ? "update:start" : "add:start",
      requestId,
      details: { name: name.trim(), schedule: schedule.trim() }
    });
    setActiveJob(name.trim());
    setError("");
    try {
      const method = editingName ? "cron.update" : "cron.add";
      await window.openclaw.gatewayCall(method, {
        name: editingName || name.trim(),
        schedule: schedule.trim(),
        command: command.trim()
      });
      setEditingName("");
      setName("");
      setSchedule("");
      setCommand("");
      await refreshCronData();
      logInfo({ area: "cron", event: editingName ? "update:success" : "add:success", requestId });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      logError({ area: "cron", event: editingName ? "update:error" : "add:error", requestId, details: { message } });
    } finally {
      setActiveJob("");
    }
  }, [command, editingName, name, refreshCronData, schedule]);

  const editJob = useCallback((job: CronJobRow) => {
    setEditingName(job.name);
    setName(job.name);
    setSchedule(job.schedule === "n/a" ? "" : job.schedule);
    setCommand(job.command === "n/a" ? "" : job.command);
  }, []);

  useEffect(() => {
    void refreshCronData();
  }, [refreshCronData]);

  const hasJobs = useMemo(() => jobs.length > 0, [jobs.length]);
  const hasRuns = useMemo(() => runs.length > 0, [runs.length]);

  return (
    <GatewayGuard gatewayRunning={gatewayRunning} onStartGateway={onStartGateway} isBusy={isBusy} detecting={detecting} startingUp={startingUp}>
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Cron Jobs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-1 gap-2 md:grid-cols-4">
              <Input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" />
              <Input value={schedule} onChange={(event) => setSchedule(event.target.value)} placeholder="Schedule (cron)" />
              <Input value={command} onChange={(event) => setCommand(event.target.value)} placeholder="Command" />
              <div className="flex gap-2">
                <Button onClick={submitJob} disabled={isBusy || loading || !name.trim() || !schedule.trim() || !command.trim()}>
                  {editingName ? "Update" : "Add"}
                </Button>
                {editingName ? (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setEditingName("");
                      setName("");
                      setSchedule("");
                      setCommand("");
                    }}
                    disabled={isBusy || loading}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </div>

            <div className="flex gap-2">
              <Button onClick={refreshCronData} disabled={isBusy || loading}>
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Schedule</TableHead>
                  <TableHead>Last Run</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hasJobs ? jobs.map((job) => (
                  <TableRow key={job.name}>
                    <TableCell>{job.name}</TableCell>
                    <TableCell>{job.schedule}</TableCell>
                    <TableCell>{job.lastRun}</TableCell>
                    <TableCell>{job.status}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => { void runJobAction("cron.run", job.name); }} disabled={isBusy || activeJob === job.name}>Run Now</Button>
                        <Button variant="outline" onClick={() => editJob(job)} disabled={isBusy || activeJob === job.name}>Edit</Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            if (window.confirm(`Remove cron job ${job.name}?`)) {
                              void runJobAction("cron.remove", job.name);
                            }
                          }}
                          disabled={isBusy || activeJob === job.name}
                        >
                          Remove
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={5} className="text-sm text-muted-foreground">No cron jobs found.</TableCell>
                    <TableCell className="hidden" />
                  </TableRow>
                )}
              </TableBody>
            </Table>

            {error ? <p className="text-xs text-destructive">{error}</p> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Run History</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Timestamp</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {hasRuns ? runs.map((run, idx) => (
                  <TableRow key={`${run.name}-${run.timestamp}-${idx}`}>
                    <TableCell>{run.name}</TableCell>
                    <TableCell>{run.timestamp}</TableCell>
                    <TableCell>{run.status}</TableCell>
                    <TableCell>{run.detail || "-"}</TableCell>
                  </TableRow>
                )) : (
                  <TableRow>
                    <TableCell colSpan={4} className="text-sm text-muted-foreground">No run history found.</TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </GatewayGuard>
  );
}
