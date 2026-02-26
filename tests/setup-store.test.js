const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

const { SetupStore } = require("../dist/main/services/setup-store.js");

test("SetupStore preserves WSL stages and messages", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-setup-store-"));

  try {
    const statePath = path.join(tempRoot, "setup-state.json");
    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          stage: "awaiting_reboot",
          requiresReboot: true,
          message: "WSL installation requires restart.",
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    const store = new SetupStore(tempRoot);
    const loaded = await store.load();

    assert.equal(loaded.stage, "awaiting_reboot");
    assert.equal(loaded.requiresReboot, true);
    assert.equal(loaded.message, "WSL installation requires restart.");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("SetupStore preserves native stages", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-setup-store-"));

  try {
    const statePath = path.join(tempRoot, "setup-state.json");
    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          stage: "installing_runtime",
          requiresReboot: false,
          message: "Installing runtime dependencies in WSL...",
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    const store = new SetupStore(tempRoot);
    const loaded = await store.load();

    assert.equal(loaded.stage, "installing_runtime");
    assert.equal(loaded.requiresReboot, false);
    assert.equal(loaded.message, "Installing runtime dependencies in WSL...");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
