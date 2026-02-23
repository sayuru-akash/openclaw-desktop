import { cp, mkdir } from "node:fs/promises";
import path from "node:path";

async function copyRendererAssets() {
  const source = path.resolve("src", "renderer");
  const target = path.resolve("dist", "renderer");
  const brandLogoSource = path.resolve("assets", "branding", "openclaw_logo.png");
  const brandLogoTarget = path.resolve(target, "openclaw_logo.png");

  await mkdir(target, { recursive: true });
  await cp(source, target, { recursive: true });
  await cp(brandLogoSource, brandLogoTarget, { force: true });
}

copyRendererAssets().catch((error) => {
  console.error("Failed to copy renderer assets", error);
  process.exitCode = 1;
});
