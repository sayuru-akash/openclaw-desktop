const test = require("node:test");
const assert = require("node:assert/strict");

const { EnvironmentService } = require("../dist/main/services/environment.js");

test("EnvironmentService checks WSL runtime as the resolved CLI user with system Node preferred", async () => {
  const service = new EnvironmentService();
  const calls = [];

  service.resolveWslBrewUser = async () => "nonu";
  service.runWslBash = async (_distro, command, _timeoutMs, user) => {
    calls.push({ command, user });
    if (command.includes("node --version")) {
      return { ok: true, code: 0, stdout: "v22.14.0\n", stderr: "" };
    }
    if (command.includes("npm --version")) {
      return { ok: true, code: 0, stdout: "10.9.2\n", stderr: "" };
    }
    return { ok: false, code: 1, stdout: "", stderr: "unexpected command" };
  };

  const status = await service.getNodeRuntimeStatus("Ubuntu");

  assert.deepEqual(status, {
    nodeInstalled: true,
    npmInstalled: true,
    nodeVersion: "v22.14.0"
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.user), ["nonu", "nonu"]);
  assert.ok(calls.every((call) => call.command.includes('export PATH="/usr/bin:/usr/local/bin:/bin:$PATH"')));
});

test("EnvironmentService rejects Node 20 for managed OpenClaw setup", async () => {
  const service = new EnvironmentService();

  service.resolveWslBrewUser = async () => "nonu";
  service.runWslBash = async (_distro, command) => {
    if (command.includes("node --version")) {
      return { ok: true, code: 0, stdout: "v20.18.1\n", stderr: "" };
    }
    if (command.includes("npm --version")) {
      return { ok: true, code: 0, stdout: "10.8.0\n", stderr: "" };
    }
    return { ok: false, code: 1, stdout: "", stderr: "unexpected command" };
  };

  const status = await service.getNodeRuntimeStatus("Ubuntu");

  assert.equal(status.nodeInstalled, false);
  assert.equal(status.npmInstalled, true);
  assert.equal(status.nodeVersion, "v20.18.1");
});

test("EnvironmentService bootstraps managed OpenClaw commands with the managed npm bin and system Node", () => {
  const service = new EnvironmentService();

  const command = service.buildWslOpenClawCommand(["gateway", "start"]);

  assert.match(command, /export PATH="\/usr\/bin:\/usr\/local\/bin:\/bin:\$PATH"/);
  assert.match(command, /export PATH="\$HOME\/\.openclaw-desktop\/npm\/bin:\$PATH"/);
  assert.ok(command.includes("\"$HOME/.openclaw-desktop/npm/bin/openclaw\""));
  assert.ok(command.includes("'gateway'"));
  assert.ok(command.includes("'start'"));
});
