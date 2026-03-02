import type { WorkspaceEditableFileName, WorkspaceFilePayload } from "../../../shared/types";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Select } from "../components/ui/select";
import { Textarea } from "../components/ui/textarea";

interface FilesPageProps {
  isBusy: boolean;
  selectedFile: WorkspaceEditableFileName;
  fileOptions: WorkspaceEditableFileName[];
  workspacePath: string;
  workspaceFile: WorkspaceFilePayload | null;
  workspaceFileEditor: string;
  onSelectedFileChange: (fileName: WorkspaceEditableFileName) => void;
  onLoadWorkspaceFile: () => void;
  onSaveWorkspaceFile: () => void;
  onWorkspaceFileEditorChange: (value: string) => void;
}

export function FilesPage({
  isBusy,
  selectedFile,
  fileOptions,
  workspacePath,
  workspaceFile,
  workspaceFileEditor,
  onSelectedFileChange,
  onLoadWorkspaceFile,
  onSaveWorkspaceFile,
  onWorkspaceFileEditorChange
}: FilesPageProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Workspace Files</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_auto_auto]">
          <Select value={selectedFile} onChange={(event) => onSelectedFileChange(event.target.value as WorkspaceEditableFileName)}>
            {fileOptions.map((file) => (
              <option key={file} value={file}>{file}</option>
            ))}
          </Select>
          <Button onClick={onLoadWorkspaceFile} disabled={isBusy || !workspacePath}>Load</Button>
          <Button variant="primary" onClick={onSaveWorkspaceFile} disabled={isBusy || !workspacePath}>Save</Button>
        </div>

        <p className="text-[11px] text-muted-foreground">
          Path: {workspaceFile?.path ?? "Not loaded"}
        </p>

        <Textarea
          className="min-h-[340px] font-mono text-[11px]"
          value={workspaceFileEditor}
          onChange={(event) => onWorkspaceFileEditorChange(event.target.value)}
          placeholder="Load a file to edit"
        />
      </CardContent>
    </Card>
  );
}
