import type { ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent } from "./ui/card";

interface GatewayGuardProps {
  gatewayRunning: boolean;
  onStartGateway: () => void | Promise<void>;
  isBusy?: boolean;
  /** True while the initial environment check is still in flight. */
  detecting?: boolean;
  /** True when the gateway process is running but the port isn't ready yet. */
  startingUp?: boolean;
  children: ReactNode;
}

export function GatewayGuard({ gatewayRunning, onStartGateway, isBusy = false, detecting = false, startingUp = false, children }: GatewayGuardProps) {
  if (detecting) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Detecting gateway status…</p>
        </CardContent>
      </Card>
    );
  }

  if (!gatewayRunning && startingUp) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          <p className="text-sm text-muted-foreground">Gateway is starting up…</p>
        </CardContent>
      </Card>
    );
  }

  if (!gatewayRunning) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-4 py-12">
          <p className="text-sm text-muted-foreground">Gateway is not running.</p>
          <Button onClick={onStartGateway} disabled={isBusy} variant="primary">
            <Play className="h-4 w-4" />
            Start Gateway
          </Button>
        </CardContent>
      </Card>
    );
  }

  return <>{children}</>;
}
