// Builds the installer and publishes it as a GitHub release (loic-daigle/benchtop).
// Installed copies of Benchtop pick it up within the hour through update.electronjs.org.
//
// Needs a GitHub token that can create releases: GITHUB_TOKEN, or the GitHub CLI's login (`gh auth login`).
// Bump "version" in package.json first: a release with the same version is not an update.
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const { version } = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
let token = process.env.GITHUB_TOKEN;
if (!token) {
  try {
    token = execFileSync('gh', ['auth', 'token'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    /* no gh */
  }
}
if (!token) {
  console.error(
    'No GitHub token. Either install the GitHub CLI and run `gh auth login`, or set GITHUB_TOKEN\n' +
      '(PowerShell: $env:GITHUB_TOKEN = "ghp_…"), with permission to create releases on loic-daigle/benchtop.',
  );
  process.exit(1);
}
console.log(`Publishing Benchtop ${version}…`);
const r = spawnSync('npx', ['electron-forge', 'publish'], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, GITHUB_TOKEN: token },
});
process.exit(r.status ?? 1);
