// SPDX-License-Identifier: GPL-3.0-only
// Copyright (c) 2026 Blinds Nisa. All rights reserved.

/**
 * Icon generator — derives every browser/OS icon from `apps/web/public/logo.svg`.
 *
 * Responsibility: own the ONE place where the brand mark is padded, plated and
 * rasterised, so no icon geometry is ever hand-copied. Run it after editing
 * `logo.svg`; commit whatever it writes.
 *
 *     node scripts/generate-icons.mjs
 *
 * Outputs (all into `apps/web/public/`):
 * - `favicon.svg`              — square, transparent, for the browser tab.
 * - `icon-192.png`             — manifest icon, `purpose: "any"`.
 * - `icon-512.png`             — manifest icon + install/splash source.
 * - `icon-maskable-512.png`    — manifest icon, `purpose: "maskable"`.
 * - `apple-touch-icon.png`     — 180px, iOS home screen.
 *
 * Two deliberate constraints drive the numbers below:
 * - **Every raster is opaque white.** iOS composites a transparent
 *   apple-touch-icon onto BLACK, which would erase this mark's black frame
 *   entirely; Android theming can do the same on a dark background. Only the SVG
 *   keeps its transparency, because the tab strip handles that correctly.
 * - **Maskable is inset much further** (60% vs 82%). Android crops maskable icons
 *   to an arbitrary shape and only the middle 80% is guaranteed to survive, so a
 *   tall mark has to sit well inside that circle or the top slat and the tassel
 *   get shaved off on round-icon launchers.
 *
 * Rasters are always rendered at 1024px and downscaled to the target with
 * Lanczos, which reads better at 180/192px than asking the SVG renderer to
 * resolve 30px corner radii directly at that size.
 *
 * `sharp` is intentionally NOT a workspace dependency — this script runs only when
 * the logo changes, and adding it would put a ~30MB native binary into every
 * Cloudflare build install. It is resolved from wherever pnpm already has it, with
 * an actionable message if it is absent.
 */

import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const require = createRequire(import.meta.url);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(repoRoot, 'apps', 'web', 'public');

/** Intrinsic size of the mark's viewBox in `logo.svg`. Must match that file. */
const MARK_WIDTH = 593;
const MARK_HEIGHT = 1060;

/** Render size for every raster before downscaling. */
const RENDER_SIZE = 1024;

/**
 * Loads `sharp` from the normal resolution path, falling back to pnpm's content
 * store (where it usually sits as a transitive dependency).
 *
 * @returns {Promise<import('sharp')>} the sharp factory
 * @throws if sharp cannot be found anywhere — the message names the fix
 */
async function loadSharp() {
  try {
    return require('sharp');
  } catch {
    // Fall through to the store lookup.
  }

  const store = path.join(repoRoot, 'node_modules', '.pnpm');
  const candidates = readdirSync(store, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('sharp@'))
    .map((entry) => path.join(store, entry.name, 'node_modules', 'sharp'))
    .sort()
    .reverse();

  for (const candidate of candidates) {
    try {
      return require(candidate);
    } catch {
      // Try the next version in the store.
    }
  }

  throw new Error(
    'sharp not found. Install it for this run with:  pnpm add -Dw sharp\n' +
      '(It is not a committed dependency on purpose — see this file\'s header.)',
  );
}

/**
 * Reads `logo.svg` and returns only its drawable contents, so the markup can be
 * re-wrapped in a square viewBox without nesting one `<svg>` inside another
 * (nested roots reset the coordinate system and break the `clipPath` reference).
 *
 * @returns {string} everything between the root `<svg>` tags
 */
function readMarkBody() {
  const source = readFileSync(path.join(publicDir, 'logo.svg'), 'utf8');
  const opened = source.indexOf('>', source.indexOf('<svg'));
  const closed = source.lastIndexOf('</svg>');
  if (opened === -1 || closed === -1) {
    throw new Error('logo.svg does not contain a parsable root <svg> element');
  }
  return source.slice(opened + 1, closed).trim();
}

/**
 * Wraps the mark in a square canvas, scaled so its HEIGHT occupies `fraction` of
 * the canvas and centred on both axes. Height drives the fit because the mark is
 * portrait (593×1060) — fitting width instead would overflow the canvas top and
 * bottom.
 *
 * @param {string} body - drawable contents from {@link readMarkBody}
 * @param {number} size - canvas edge length in user units
 * @param {number} fraction - share of the canvas height the mark should fill (0–1)
 * @param {string | null} background - opaque plate colour, or null to stay transparent
 * @returns {string} a standalone square SVG document
 */
function squareSvg(body, size, fraction, background) {
  const scale = (size * fraction) / MARK_HEIGHT;
  const offsetX = (size - MARK_WIDTH * scale) / 2;
  const offsetY = (size - MARK_HEIGHT * scale) / 2;
  const plate = background ? `<rect width="${size}" height="${size}" fill="${background}"/>` : '';
  const round = (value) => Number(value.toFixed(4));

  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`,
    plate,
    `<g transform="translate(${round(offsetX)} ${round(offsetY)}) scale(${round(scale)})">`,
    body,
    '</g>',
    '</svg>',
  ].join('');
}

/**
 * Rasterises a square SVG to an opaque PNG at `size`.
 *
 * @param {import('sharp')} sharp
 * @param {string} svg - a standalone square SVG document
 * @param {number} size - output edge length in pixels
 * @param {string} file - destination filename inside `apps/web/public/`
 */
async function writePng(sharp, svg, size, file) {
  await sharp(Buffer.from(svg), { density: 384 })
    .resize(size, size, { kernel: 'lanczos3' })
    .flatten({ background: '#ffffff' })
    .png({ compressionLevel: 9 })
    .toFile(path.join(publicDir, file));
  console.log(`  ${file}  ${size}×${size}`);
}

/** Generates every icon, in dependency order (SVG first, then rasters). */
async function main() {
  const sharp = await loadSharp();
  const body = readMarkBody();

  const header = [
    '<!--',
    '  SPDX-License-Identifier: GPL-3.0-only',
    '  Copyright (c) 2026 Blinds Nisa. All rights reserved.',
    '',
    '  GENERATED by scripts/generate-icons.mjs from logo.svg — do not edit by hand.',
    '-->',
    '',
  ].join('\n');

  writeFileSync(
    path.join(publicDir, 'favicon.svg'),
    `${header}${squareSvg(body, 1024, 0.88, null)}\n`,
    'utf8',
  );
  console.log('  favicon.svg  (transparent)');

  // purpose: "any" — nearly full-bleed; launchers show these as authored.
  await writePng(sharp, squareSvg(body, RENDER_SIZE, 0.82, '#ffffff'), 192, 'icon-192.png');
  await writePng(sharp, squareSvg(body, RENDER_SIZE, 0.82, '#ffffff'), 512, 'icon-512.png');

  // purpose: "maskable" — inset for Android's arbitrary crop shapes.
  await writePng(
    sharp,
    squareSvg(body, RENDER_SIZE, 0.6, '#ffffff'),
    512,
    'icon-maskable-512.png',
  );

  // iOS applies its own corner rounding, so this sits between the two.
  await writePng(sharp, squareSvg(body, RENDER_SIZE, 0.78, '#ffffff'), 180, 'apple-touch-icon.png');
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
