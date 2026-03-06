const test = require("node:test");
const assert = require("node:assert/strict");

const { SetupOrchestrator } = require("../dist/main/services/setup-orchestrator.js");

function createStore() {
  return {
    async load() {
      return {
        stage: "idle",
        requiresReboot: false,
        message: "Setup has not started yet.",
        updatedAt: new Date(0).toISOString()
      };
    },
    async save(next) {
      return {
        stage: next.stage ?? "idle",
        requiresReboot: next.requiresReboot ?? false,
        message: next.message ?? "",
        updatedAt: new Date().toISOString()
      };
    }
  };
}

test("SetupOrchestrator skips restarting the gateway during finish when it is already healthy", async () => {
  let gatewayStartCalls = 0;
  const environmentService = {
    async getEnvironmentStatus() {
      return { gatewayRunning: true };
    },
    async gatewayStartStreaming() {
      gatewayStartCalls += 1;
      return { ok: true, code: 0, stdout: "", stderr: "" };
    }
  };

  const orchestrator = new SetupOrchestrator(environmentService, createStore());
  const state = await orchestrator.completeOnboardingFromUi();

  assert.equal(gatewayStartCalls, 0);
  assert.equal(state.stage, "completed");
  assert.equal(state.message, "Setup complete. OpenClaw gateway is running.");
});
