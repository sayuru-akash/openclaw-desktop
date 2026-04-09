const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");

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
    nodeVersion: "v22.14.0",
  });
  assert.equal(calls.length, 2);
  assert.deepEqual(
    calls.map((call) => call.user),
    ["nonu", "nonu"],
  );
  assert.ok(
    calls.every((call) =>
      call.command.includes('export PATH="/usr/bin:/usr/local/bin:/bin:$PATH"'),
    ),
  );
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

  assert.match(
    command,
    /export PATH="\/usr\/bin:\/usr\/local\/bin:\/bin:\$PATH"/,
  );
  assert.match(
    command,
    /export PATH="\$HOME\/\.openclaw-desktop\/npm\/bin:\$PATH"/,
  );
  assert.ok(command.includes('"$HOME/.openclaw-desktop/npm/bin/openclaw"'));
  assert.ok(command.includes("'gateway'"));
  assert.ok(command.includes("'start'"));
});

test("EnvironmentService resolves macOS managed OpenClaw through the npm bin path", () => {
  const service = new EnvironmentService();

  const env = service.buildCommandEnv();
  const managedPrefix = path.join(os.homedir(), ".openclaw-desktop", "npm");

  assert.ok(env.PATH.includes(path.join(managedPrefix, "bin")));
  assert.equal(
    service.getManagedOpenClawPath(),
    path.join(managedPrefix, "bin", "openclaw"),
  );
});

test("EnvironmentService waits for gateway port ready on successful start", async () => {
  const service = new EnvironmentService();
  let portCheckAttempts = 0;
  const portReadyAfterAttempt = 3;

  service.runOpenClaw = async () => ({
    ok: true,
    code: 0,
    stdout: "Gateway started",
    stderr: "",
  });

  service.isGatewayPortReady = async () => {
    portCheckAttempts++;
    return portCheckAttempts >= portReadyAfterAttempt;
  };

  const result = await service.gatewayStart();

  assert.ok(result.ok);
  assert.ok(
    portCheckAttempts >= portReadyAfterAttempt,
    "Should have retried port checks until port was ready",
  );
});

test("EnvironmentService getModelStatus uses streaming output for large catalogs", async () => {
  const service = new EnvironmentService();
  const firstKey = "provider-a/model-alpha";
  const secondKey = "provider-b/model-beta";

  let usedStreaming = false;
  service.runOpenClaw = async () => {
    throw new Error("runOpenClaw should not be used for model catalog fetch");
  };
  service.runOpenClawStreaming = async () => {
    usedStreaming = true;
    return {
      ok: true,
      code: 0,
      stdout: JSON.stringify({
        count: 2,
        models: [
          { key: firstKey, name: "Model Alpha" },
          { key: secondKey, name: "Model Beta" },
        ],
      }),
      stderr: "",
    };
  };

  const status = await service.getModelStatus();

  assert.equal(usedStreaming, true);
  assert.deepEqual(status.availableProviders, ["provider-a", "provider-b"]);
  assert.deepEqual(status.modelsByProvider, {
    "provider-a": [firstKey],
    "provider-b": [secondKey],
  });
});

test("EnvironmentService parseJsonOutput prefers object payload over scalar lines", () => {
  const service = new EnvironmentService();

  const mixedOutput = [
    "[agents] synced credentials",
    "{",
    '  "count": 1,',
    '  "models": [',
    "    {",
    '      "key": "provider-a/model-alpha",',
    '      "name": "Model Alpha",',
    '      "tags": [',
    '        "default"',
    "      ]",
    "    }",
    "  ]",
    "}",
  ].join("\n");

  const parsed = service.parseJsonOutput(mixedOutput, "");
  assert.equal(typeof parsed, "object");
  assert.ok(parsed);
  assert.equal(parsed.count, 1);
  assert.equal(Array.isArray(parsed.models), true);
});
