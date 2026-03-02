import type { Dispatch, SetStateAction } from "react";
import type { AppConfig } from "../../../shared/types";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";

interface SettingsPageProps {
  isBusy: boolean;
  configDraft: AppConfig | null;
  setConfigDraft: Dispatch<SetStateAction<AppConfig | null>>;
  modelProviders: string[];
  settingsModelOptions: string[];
  modelDisplayNames?: Record<string, string>;
  alwaysOnEnabled: boolean;
  alwaysOnSupported: boolean;
  alwaysOnDetail: string;
  onToggleAlwaysOn: (enabled: boolean) => void;
  onSaveSettings: () => void;
  onReloadConfig: () => void;
}

export function SettingsPage({
  isBusy,
  configDraft,
  setConfigDraft,
  modelProviders,
  settingsModelOptions,
  modelDisplayNames,
  alwaysOnEnabled,
  alwaysOnSupported,
  alwaysOnDetail,
  onToggleAlwaysOn,
  onSaveSettings,
  onReloadConfig
}: SettingsPageProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Profile Name</p>
            <Input
              value={configDraft?.profileName ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, profileName: event.target.value } : current)}
              placeholder="Default"
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Workspace Path</p>
            <Input
              value={configDraft?.workspacePath ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, workspacePath: event.target.value } : current)}
              placeholder="C:\\Users\\You\\OpenClaw"
            />
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model Provider</p>
            <Select
              value={configDraft?.modelProvider ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, modelProvider: event.target.value, modelName: "" } : current)}
            >
              <option value="">Select provider</option>
              {modelProviders.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model Name</p>
            <Select
              value={configDraft?.modelName ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, modelName: event.target.value } : current)}
            >
              <option value="">Select model</option>
              {settingsModelOptions.map((model) => (
                <option key={model} value={model}>{modelDisplayNames?.[model] || model}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1 md:col-span-2">
            <p className="text-[11px] text-muted-foreground">Auth URL</p>
            <Input
              value={configDraft?.authWebBaseUrl ?? ""}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, authWebBaseUrl: event.target.value } : current)}
              placeholder="https://auth.openclawdesk.top"
            />
          </div>
        </div>

        <div className="grid gap-2">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={Boolean(configDraft?.autoStartGateway)}
              onChange={(event) => setConfigDraft((current) => current ? { ...current, autoStartGateway: event.target.checked } : current)}
            />
            Start gateway on app launch
          </label>

          <label className="flex items-center justify-between rounded-sm border border-border bg-muted/40 p-2 text-xs text-muted-foreground">
            <span>Always-on gateway (startup)</span>
            <input
              type="checkbox"
              checked={alwaysOnEnabled}
              disabled={isBusy || !alwaysOnSupported}
              onChange={(event) => onToggleAlwaysOn(event.target.checked)}
            />
          </label>
          <p className="text-[11px] text-muted-foreground">{alwaysOnDetail}</p>
        </div>

        <div className="flex gap-2">
          <Button variant="primary" onClick={onSaveSettings} disabled={isBusy || !configDraft}>Save Settings</Button>
          <Button variant="outline" onClick={onReloadConfig} disabled={isBusy}>Reload</Button>
        </div>
      </CardContent>
    </Card>
  );
}
