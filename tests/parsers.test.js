const test = require("node:test");
const assert = require("node:assert/strict");

const {
  parseWindowsBuildFromRelease,
  isWindowsBuildSupported,
  isGatewayRunningOutput,
  isScheduledTaskMissing,
  inferChannelStatusFromPayload,
  inferModelStatusFromPayload
} = require("../dist/main/services/parsers.js");

test("parseWindowsBuildFromRelease extracts build number", () => {
  assert.equal(parseWindowsBuildFromRelease("10.0.19045"), 19045);
  assert.equal(parseWindowsBuildFromRelease("10.0.22631"), 22631);
  assert.equal(parseWindowsBuildFromRelease("invalid"), null);
});

test("isWindowsBuildSupported enforces minimum build for seamless WSL flow", () => {
  assert.equal(isWindowsBuildSupported(18363), false);
  assert.equal(isWindowsBuildSupported(19041), true);
  assert.equal(isWindowsBuildSupported(22631), true);
  assert.equal(isWindowsBuildSupported(null), false);
});

test("isGatewayRunningOutput detects running states", () => {
  assert.equal(isGatewayRunningOutput("Gateway is running"), true);
  assert.equal(isGatewayRunningOutput("status: active"), true);
  assert.equal(isGatewayRunningOutput("status: stopped"), false);
});

test("isScheduledTaskMissing detects missing task output", () => {
  const missing = {
    ok: false,
    code: 1,
    stdout: "",
    stderr: "ERROR: The system cannot find the file specified."
  };
  const found = {
    ok: true,
    code: 0,
    stdout: "TaskName: OpenClawDesktopAlwaysOnGateway",
    stderr: ""
  };

  assert.equal(isScheduledTaskMissing(missing), true);
  assert.equal(isScheduledTaskMissing(found), false);
});

test("inferChannelStatusFromPayload marks connected channel", () => {
  const payload = {
    status: "connected",
    message: "WhatsApp connected and active"
  };

  const status = inferChannelStatusFromPayload("whatsapp", payload, "");
  assert.equal(status.channel, "whatsapp");
  assert.equal(status.configured, true);
  assert.equal(status.connected, true);
  assert.equal(status.summary, "Connected");
});

test("inferChannelStatusFromPayload marks unconfigured channel", () => {
  const status = inferChannelStatusFromPayload(
    "telegram",
    "channel not configured",
    "channel not configured"
  );

  assert.equal(status.configured, false);
  assert.equal(status.connected, false);
  assert.equal(status.summary, "Not configured");
});

test("inferModelStatusFromPayload extracts provider/model from nested payload", () => {
  const payload = {
    result: {
      activeProvider: "openai",
      activeModel: "gpt-4o-mini",
      providers: [
        {
          provider: "openai",
          models: ["gpt-4o-mini", "gpt-4.1-mini"]
        },
        {
          provider: "anthropic",
          models: [{ id: "claude-3-7-sonnet" }]
        }
      ]
    }
  };

  const inferred = inferModelStatusFromPayload(payload);
  assert.equal(inferred.provider, "openai");
  assert.equal(inferred.model, "gpt-4o-mini");
  assert.deepEqual(inferred.availableProviders, ["anthropic", "openai"]);
  assert.deepEqual(inferred.modelsByProvider, {
    anthropic: ["claude-3-7-sonnet"],
    openai: ["gpt-4.1-mini", "gpt-4o-mini"]
  });
  assert.equal(inferred.detail, "Using openai / gpt-4o-mini");
});

test("inferModelStatusFromPayload handles empty payload", () => {
  const inferred = inferModelStatusFromPayload({});
  assert.equal(inferred.provider, "");
  assert.equal(inferred.model, "");
  assert.deepEqual(inferred.availableProviders, []);
  assert.deepEqual(inferred.modelsByProvider, {});
  assert.equal(inferred.detail, "Model is not configured yet.");
});
