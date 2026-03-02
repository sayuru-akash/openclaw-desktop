import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Select } from "../components/ui/select";

interface ModelsPageProps {
  isBusy: boolean;
  openClawInstalled: boolean;
  manageProvider: string;
  manageModel: string;
  manageApiKey: string;
  modelProviders: string[];
  modelOptions: string[];
  modelDisplayNames?: Record<string, string>;
  onProviderChange: (value: string) => void;
  onModelChange: (value: string) => void;
  onApiKeyChange: (value: string) => void;
  onApplyModelSelection: () => void;
  onRefreshModels: () => void;
}

export function ModelsPage({
  isBusy,
  openClawInstalled,
  manageProvider,
  manageModel,
  manageApiKey,
  modelProviders,
  modelOptions,
  modelDisplayNames,
  onProviderChange,
  onModelChange,
  onApiKeyChange,
  onApplyModelSelection,
  onRefreshModels
}: ModelsPageProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Model Management</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Provider</p>
            <Select value={manageProvider} onChange={(event) => onProviderChange(event.target.value)}>
              <option value="">Select provider</option>
              {modelProviders.map((provider) => (
                <option key={provider} value={provider}>{provider}</option>
              ))}
            </Select>
          </div>

          <div className="space-y-1">
            <p className="text-[11px] text-muted-foreground">Model</p>
            <Select value={manageModel} onChange={(event) => onModelChange(event.target.value)}>
              <option value="">Select model</option>
              {modelOptions.map((model) => (
                <option key={model} value={model}>{modelDisplayNames?.[model] || model}</option>
              ))}
            </Select>
          </div>
        </div>

        <div className="space-y-1">
          <p className="text-[11px] text-muted-foreground">API Key</p>
          <Input
            type="password"
            placeholder="Paste API key"
            value={manageApiKey}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
          {manageApiKey.length > 0 && manageApiKey.trim().length < 8 && (
            <p className="text-xs text-destructive">API key must be at least 8 characters.</p>
          )}
        </div>

        <div className="flex gap-2">
          <Button variant="primary" onClick={onApplyModelSelection} disabled={isBusy || !manageProvider || !manageModel}>
            Apply Model
          </Button>
          <Button variant="outline" onClick={onRefreshModels} disabled={isBusy || !openClawInstalled}>
            Refresh
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
