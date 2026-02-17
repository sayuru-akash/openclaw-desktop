import type { CommandResult } from "../../shared/types";
import { runCommand } from "./command-runner";

const runKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export class WindowsStartupService {
  private readonly valueName = "OpenClawDesktopSetupResume";

  public registerResumeOnLogin(commandLine: string): Promise<CommandResult> {
    return runCommand("reg.exe", [
      "add",
      runKey,
      "/v",
      this.valueName,
      "/t",
      "REG_SZ",
      "/d",
      commandLine,
      "/f"
    ]);
  }

  public clearResumeOnLogin(): Promise<CommandResult> {
    return runCommand(
      "reg.exe",
      ["delete", runKey, "/v", this.valueName, "/f"],
      { okExitCodes: [1] }
    );
  }
}
