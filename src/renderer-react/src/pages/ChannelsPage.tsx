import { Badge } from "../components/ui/badge";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Separator } from "../components/ui/separator";

interface ChannelViewState {
  connected: boolean;
  configured: boolean;
  summary: string;
}

interface ChannelsPageProps {
  isBusy: boolean;
  openClawInstalled: boolean;
  whatsapp: ChannelViewState;
  telegram: ChannelViewState;
  telegramToken: string;
  onTelegramTokenChange: (value: string) => void;
  onReconnectWhatsapp: () => void;
  onDisableWhatsapp: () => void;
  onReconnectTelegram: () => void;
  onDisableTelegram: () => void;
  onSaveTelegramToken: () => void;
}

export function ChannelsPage({
  isBusy,
  openClawInstalled,
  whatsapp,
  telegram,
  telegramToken,
  onTelegramTokenChange,
  onReconnectWhatsapp,
  onDisableWhatsapp,
  onReconnectTelegram,
  onDisableTelegram,
  onSaveTelegramToken
}: ChannelsPageProps) {
  return (
    <div className="space-y-3">
      <Card>
        <CardHeader>
          <CardTitle>Channel Management</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <Card className="bg-muted/40">
              <CardHeader>
                <CardTitle className="text-sm">WhatsApp</CardTitle>
                <Badge variant={whatsapp.connected ? "success" : whatsapp.configured ? "warning" : "danger"}>{whatsapp.summary}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={onReconnectWhatsapp} disabled={isBusy || !openClawInstalled}>Reconnect</Button>
                  <Button variant="outline" onClick={onDisableWhatsapp} disabled={isBusy || !openClawInstalled}>Disable</Button>
                </div>
              </CardContent>
            </Card>

            <Card className="bg-muted/40">
              <CardHeader>
                <CardTitle className="text-sm">Telegram</CardTitle>
                <Badge variant={telegram.connected ? "success" : telegram.configured ? "warning" : "danger"}>{telegram.summary}</Badge>
              </CardHeader>
              <CardContent className="space-y-2 text-xs text-muted-foreground">
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={onReconnectTelegram} disabled={isBusy || !openClawInstalled}>Reconnect</Button>
                  <Button variant="outline" onClick={onDisableTelegram} disabled={isBusy || !openClawInstalled}>Disable</Button>
                </div>
              </CardContent>
            </Card>
          </div>

          <Separator />

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto]">
            <Input
              value={telegramToken}
              onChange={(event) => onTelegramTokenChange(event.target.value)}
              placeholder="Bot token"
            />
            <Button onClick={onSaveTelegramToken} disabled={isBusy || !telegramToken.trim()}>Save Token</Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
