import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const releaseDir = join(process.cwd(), 'release');
const allowedPlatforms = new Set(['auto', 'win', 'mac', 'all']);

const platformArg = process.argv.find((arg) => arg.startsWith('--platform='));
const requestedPlatform = (platformArg?.split('=')[1] ?? 'auto').toLowerCase();

if (!allowedPlatforms.has(requestedPlatform)) {
  console.error(`❌ Unsupported --platform value: ${requestedPlatform}`);
  console.error(`Use one of: ${Array.from(allowedPlatforms).join(', ')}`);
  process.exit(1);
}

if (!existsSync(releaseDir)) {
  console.error('❌ release/ directory not found. Run a dist script first.');
  process.exit(1);
}

const files = readdirSync(releaseDir).sort();
const installers = {
  exe: files.filter((file) => file.endsWith('.exe')),
  dmg: files.filter((file) => file.endsWith('.dmg')),
  pkg: files.filter((file) => file.endsWith('.pkg')),
  zip: files.filter((file) => file.endsWith('.zip')),
  yml: files.filter((file) => file.endsWith('.yml')),
  blockmap: files.filter((file) => file.endsWith('.blockmap'))
};

const hasWindowsArtifacts = installers.exe.length > 0;
const hasMacArtifacts = installers.dmg.length > 0 || installers.pkg.length > 0 || installers.zip.length > 0;

const platform =
  requestedPlatform === 'auto'
    ? hasWindowsArtifacts && !hasMacArtifacts
      ? 'win'
      : !hasWindowsArtifacts && hasMacArtifacts
        ? 'mac'
        : 'all'
    : requestedPlatform;

if (!hasWindowsArtifacts && !hasMacArtifacts) {
  console.error('❌ No expected installers found (.exe, .dmg, .pkg, .zip).');
  process.exit(1);
}

function archFromMacArtifact(fileName) {
  if (fileName.includes('-arm64.')) return 'arm64';
  if (fileName.includes('-x64.')) return 'x64';
  return null;
}

function ensure(condition, message) {
  if (!condition) {
    console.error(`❌ ${message}`);
    process.exit(1);
  }
}

if (platform === 'win' || platform === 'all') {
  ensure(installers.exe.length > 0, 'Missing Windows .exe installer artifact.');
  ensure(installers.yml.length > 0, 'Missing update metadata .yml file for Windows publish flow.');
}

if (platform === 'mac' || platform === 'all') {
  ensure(installers.dmg.length > 0, 'Missing macOS .dmg artifact.');
  ensure(installers.pkg.length > 0, 'Missing macOS .pkg artifact.');
  ensure(installers.zip.length > 0, 'Missing macOS .zip artifact (required for electron-updater).');

  const requiredArchs = ['x64', 'arm64'];
  for (const arch of requiredArchs) {
    ensure(
      installers.dmg.some((file) => archFromMacArtifact(file) === arch),
      `Missing macOS .dmg for ${arch}.`
    );
    ensure(
      installers.pkg.some((file) => archFromMacArtifact(file) === arch),
      `Missing macOS .pkg for ${arch}.`
    );
    ensure(
      installers.zip.some((file) => archFromMacArtifact(file) === arch),
      `Missing macOS .zip for ${arch}.`
    );
  }

  const hasMacYml = installers.yml.some((file) => file.toLowerCase().includes('latest-mac'));
  ensure(hasMacYml, 'Missing macOS update metadata (latest-mac.yml).');
}

console.log(`✅ Installer artifact verification passed for platform: ${platform}`);
console.log(`Detected artifacts in release/:\n- ${files.join('\n- ')}`);
