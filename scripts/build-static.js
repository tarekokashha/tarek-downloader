#!/usr/bin/env node
/**
 * Builds the static front end for a host like Vercel.
 *
 * The interface is plain HTML, CSS and JS with no bundler, so "building" means
 * copying `public/` and stamping in the engine address. Vercel cannot run the
 * downloader itself — that needs a long-lived process and a real disk — so the
 * page it serves talks to an engine running elsewhere.
 *
 * Set STASH_ENGINE in the deploy's environment to bake in the address; leave it
 * unset and the page asks the visitor for one on first load.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'public');
const OUTPUT = path.join(ROOT, '.vercel-static');

const engine = (process.env.STASH_ENGINE ?? '').trim().replace(/\/$/, '');

if (engine && !/^https:\/\//i.test(engine)) {
  console.error(`STASH_ENGINE must be an https:// URL, got: ${engine}`);
  process.exit(1);
}

await fsp.rm(OUTPUT, { recursive: true, force: true });
await fsp.mkdir(OUTPUT, { recursive: true });
await fsp.cp(SOURCE, OUTPUT, { recursive: true });

// Stamp the engine address into the page.
const indexPath = path.join(OUTPUT, 'index.html');
let html = await fsp.readFile(indexPath, 'utf8');
html = html.replace('__STASH_ENGINE__', engine);
await fsp.writeFile(indexPath, html);

const files = fs.readdirSync(OUTPUT);
console.log(`Built ${files.length} files into .vercel-static`);
console.log(engine ? `Engine baked in: ${engine}` : 'No STASH_ENGINE set — visitors will be asked for one.');
