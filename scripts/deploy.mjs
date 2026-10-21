// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Interactive Cloudflare deploy — asks which apps to ship, then runs
 * `npx wrangler deploy` inside each chosen `apps/<name>` directory.
 *
 * Responsibility: be the one root-level entry point for deploys, so nobody has
 * to `cd` into an app or remember which ones need a build first.
 *
 *     pnpm run deploy:apps            # prompts with a numbered list
 *     pnpm run deploy:apps web api    # skips the prompt
 *
 * Behaviour:
 * - **Discovery.** An app is deployable when `apps/<name>/wrangler.toml` exists;
 *   adding a new Worker under `apps/` makes it appear here with no edits.
 * - **Build first.** If the app's `package.json` has a `build` script it runs
 *   (`pnpm run build`) before deploying. `apps/web` serves `./dist` as static
 *   assets, so deploying without a build would ship a stale or missing bundle.
 *   `apps/api` has no build script — wrangler bundles `src/index.ts` itself.
 * - **Sequential, fail-fast.** Apps deploy one at a time with inherited stdio
 *   (wrangler's own prompts and login flow keep working); the first failure
 *   stops the run and exits non-zero, so a broken API never ships half a release.
 *
 * Uses Node built-ins only — no dependency to install before you can deploy.
 */

import { spawn } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const APPS_DIR = join(ROOT, 'apps');

/**
 * Lists every app under `apps/` that has a `wrangler.toml`, with the Worker
 * name read from it (shown in the prompt so "web" vs "measure-blinds" is clear).
 *
 * @returns {{ name: string, dir: string, worker: string, hasBuild: boolean }[]}
 *   Deployable apps sorted by directory name.
 */
function discoverApps() {
  return readdirSync(APPS_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(APPS_DIR, entry.name, 'wrangler.toml')))
    .map((entry) => {
      const dir = join(APPS_DIR, entry.name);
      const toml = readFileSync(join(dir, 'wrangler.toml'), 'utf8');
      const worker = toml.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1] ?? '?';
      const pkgPath = join(dir, 'package.json');
      const scripts = existsSync(pkgPath) ? JSON.parse(readFileSync(pkgPath, 'utf8')).scripts ?? {} : {};
      return { name: entry.name, dir, worker, hasBuild: Boolean(scripts.build) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Turns the user's answer into a list of apps. Accepts numbers or names,
 * separated by commas or spaces, plus `a`/`all`.
 *
 * @param {string} answer Raw input, e.g. `"1,2"`, `"web api"`, `"all"`.
 * @param {ReturnType<typeof discoverApps>} apps The discovered apps, in prompt order.
 * @returns {ReturnType<typeof discoverApps> | null} Chosen apps in prompt order
 *   (duplicates collapsed), or `null` if any token matched nothing.
 */
function parseSelection(answer, apps) {
  const tokens = answer.split(/[\s,]+/).filter(Boolean);
  if (tokens.length === 0) return null;
  if (tokens.some((t) => t === 'a' || t === 'all')) return apps;
  const picked = new Set();
  for (const token of tokens) {
    const byIndex = /^\d+$/.test(token) ? apps[Number(token) - 1] : undefined;
    const app = byIndex ?? apps.find((candidate) => candidate.name === token);
    if (!app) return null;
    picked.add(app);
  }
  return apps.filter((app) => picked.has(app));
}

/**
 * Prints the numbered app list and asks until the answer parses.
 *
 * @param {ReturnType<typeof discoverApps>} apps Apps to offer.
 * @returns {Promise<ReturnType<typeof discoverApps>>} The confirmed selection.
 */
async function promptForApps(apps) {
  console.log('\nWhich apps do you want to deploy?\n');
  apps.forEach((app, i) => console.log(`  ${i + 1}) ${app.name.padEnd(8)} → ${app.worker}`));
  console.log('  a) all\n');
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const selection = parseSelection(await rl.question('Select (e.g. 1,2 or web api): '), apps);
      if (selection) return selection;
      console.log('  Not recognised — use the numbers or names above, or "a" for all.');
    }
  } finally {
    rl.close();
  }
}

/**
 * Runs a command in `cwd` with the terminal attached, resolving on exit 0.
 *
 * @param {string} command Executable (`pnpm`, `npx`).
 * @param {string[]} args Arguments.
 * @param {string} cwd Working directory — the app's folder.
 * @returns {Promise<void>} Rejects with the exit code when the command fails.
 */
function run(command, args, cwd) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: process.platform === 'win32' });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${command} ${args.join(' ')} exited with ${code}`)),
    );
  });
}

async function main() {
  const apps = discoverApps();
  if (apps.length === 0) {
    console.error('No apps with a wrangler.toml found under apps/.');
    process.exit(1);
  }

  const cliArgs = process.argv.slice(2);
  const selection = cliArgs.length ? parseSelection(cliArgs.join(' '), apps) : await promptForApps(apps);
  if (!selection) {
    console.error(`Unknown app in "${cliArgs.join(' ')}". Available: ${apps.map((a) => a.name).join(', ')}`);
    process.exit(1);
  }

  for (const app of selection) {
    console.log(`\n━━ ${app.name} (${app.worker}) ━━`);
    if (app.hasBuild) await run('pnpm', ['run', 'build'], app.dir);
    await run('npx', ['wrangler', 'deploy'], app.dir);
  }
  console.log(`\n✓ Deployed: ${selection.map((a) => a.name).join(', ')}`);
}

main().catch((error) => {
  console.error(`\n✗ Deploy stopped: ${error.message}`);
  process.exit(1);
});
