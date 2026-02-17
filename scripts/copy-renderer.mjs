import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

async function copyRendererAssets() {
  const source = path.resolve("src", "renderer");
  const target = path.resolve("dist", "renderer");

  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
}

copyRendererAssets().catch((error) => {
  console.error("Failed to copy renderer assets", error);
  process.exitCode = 1;
});
