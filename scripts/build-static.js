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
 * unset and the page asks the visitor for one on first load, then remembers it.
 * Unset is the better default for a Cloudflare quick tunnel, whose hostname
 * changes every restart.
 */

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = path.join(ROOT, 'public');
const OUTPUT = path.join(ROOT, '.vercel-static');

const engine = (process.env.STASH_ENGINE ?? '').trim().replace(/\/+$/, '');

if (engine && !/^https:\/\//i.test(engine)) {
  console.error(`STASH_ENGINE must be an https:// URL, got: ${engine}`);
  process.exit(1);
}

/*
 * A quick tunnel gets a fresh random hostname every time cloudflared starts,
 * so baking one in produces a page that works until the next restart and then
 * points at a name that no longer exists in DNS. Refuse it: leaving the
 * address out entirely gives a page that asks for the current one instead.
 */
if (/\.trycloudflare\.com$/i.test(new URL(engine || 'https://x.invalid').hostname)) {
  console.error(
    'STASH_ENGINE is a Cloudflare quick tunnel, whose hostname changes on every\n' +
    'restart — baking it in guarantees a dead link later. Either leave\n' +
    'STASH_ENGINE unset and enter the address in the browser, or use a named\n' +
    'tunnel with a hostname of your own (see DEPLOY.md).',
  );
  process.exit(1);
}

await fsp.rm(OUTPUT, { recursive: true, force: true });
await fsp.mkdir(OUTPUT, { recursive: true });
await fsp.cp(SOURCE, OUTPUT, { recursive: true });

// Stamp the engine address into the page's one piece of deploy-time config.
const enginePath = path.join(OUTPUT, 'engine.js');
const source = await fsp.readFile(enginePath, 'utf8');
await fsp.writeFile(
  enginePath,
  source.replace("window.STASH_ENGINE = '';", `window.STASH_ENGINE = ${JSON.stringify(engine)};`),
);

const files = fs.readdirSync(OUTPUT);
console.log(`Built ${files.length} files into .vercel-static`);
console.log(engine ? `Engine baked in: ${engine}` : 'No STASH_ENGINE set — visitors will be asked for one.');
