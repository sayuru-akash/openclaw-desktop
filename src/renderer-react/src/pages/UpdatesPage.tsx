import type { UpdateStatusEvent } from "../../../shared/types";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

interface UpdatesPageProps {
  isBusy: boolean;
  updateStatus: UpdateStatusEvent | null;
  canInstallUpdate: boolean;
  onCheckForUpdates: () => void;
  onInstallUpdate: () => void;
}

export function UpdatesPage({
  isBusy,
  updateStatus,
  canInstallUpdate,
  onCheckForUpdates,
  onInstallUpdate
}: UpdatesPageProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Updates</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">
          State: {updateStatus?.state ?? "idle"}
          {typeof updateStatus?.progress === "number" ? ` (${Math.round(updateStatus.progress)}%)` : ""}
        </p>

        <div className="flex gap-2">
          <Button onClick={onCheckForUpdates} disabled={isBusy}>Check</Button>
          <Button variant="primary" onClick={onInstallUpdate} disabled={isBusy || !canInstallUpdate}>Install + Restart</Button>
        </div>
      </CardContent>
    </Card>
  );
}
