const test = require("node:test");
const assert = require("node:assert/strict");
const os = require("node:os");
const path = require("node:path");
const fs = require("node:fs/promises");

const { SetupStore } = require("../dist/main/services/setup-store.js");

test("SetupStore migrates legacy WSL stages to failed native state", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "openclaw-setup-store-"));

  try {
    const statePath = path.join(tempRoot, "setup-state.json");
    await fs.writeFile(
      statePath,
      JSON.stringify(
        {
          stage: "installing_wsl",
          requiresReboot: true,
          message: "Requesting admin approval to install WSL.",
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    const store = new SetupStore(tempRoot);
    const loaded = await store.load();

    assert.equal(loaded.stage, "failed");
    assert.equal(loaded.requiresReboot, true);
    assert.match(loaded.message, /legacy setup state detected/i);
    assert.doesNotMatch(loaded.message, /wsl/i);
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
          stage: "installing_node",
          requiresReboot: false,
          message: "Installing Node.js runtime...",
          updatedAt: new Date().toISOString()
        },
        null,
        2
      ),
      "utf8"
    );

    const store = new SetupStore(tempRoot);
    const loaded = await store.load();

    assert.equal(loaded.stage, "installing_node");
    assert.equal(loaded.requiresReboot, false);
    assert.equal(loaded.message, "Installing Node.js runtime...");
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});
