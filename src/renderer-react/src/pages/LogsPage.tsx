import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";

interface LogsPageProps {
  logs: string[];
}

export function LogsPage({ logs }: LogsPageProps) {
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle>Live Log</CardTitle>
      </CardHeader>
      <CardContent>
        <pre className="h-[calc(100vh-13rem)] overflow-auto rounded-sm border border-border bg-[#141414] p-3 text-[11px] leading-5 text-muted-foreground">
          {logs.join("\n")}
        </pre>
      </CardContent>
    </Card>
  );
}
