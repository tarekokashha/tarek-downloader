import fsp from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import jobs from './jobs.js';
import log from './log.js';

/**
 * Removes finished downloads once their time-to-live expires, then prunes the
 * in-memory job index. Without this a long-running instance fills the disk.
 */
async function sweep() {
  if (config.fileTtlMinutes <= 0) {
    jobs.prune();
    return;
  }

  const cutoff = Date.now() - config.fileTtlMinutes * 60_000;
  let removed = 0;
  let freed = 0;

  let entries;
  try {
    entries = await fsp.readdir(config.downloadDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(config.downloadDir, entry.name);

    try {
      const stat = await fsp.stat(dir);
      if (stat.mtimeMs > cutoff) continue;

      // Never delete a directory belonging to a job that is still running.
      const job = jobs.get(entry.name);
      if (job && !['done', 'error', 'canceled'].includes(job.status)) continue;

      freed += await directorySize(dir);
      await fsp.rm(dir, { recursive: true, force: true });
      removed += 1;

      if (job) {
        job.files = [];
        job.archive = null;
        if (job.status === 'done') {
          jobs.update(job, { phase: 'Expired — files removed' });
        }
      }
    } catch {
      // A concurrent read or a locked file; try again next sweep.
    }
  }

  jobs.prune();
  if (removed) {
    log.info(`Cleanup removed ${removed} expired download${removed === 1 ? '' : 's'} (${(freed / 1e6).toFixed(1)} MB).`);
  }
}

async function directorySize(dir) {
  let total = 0;
  try {
    for (const entry of await fsp.readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await directorySize(full);
      else total += (await fsp.stat(full)).size;
    }
  } catch { /* best effort */ }
  return total;
}

export function startCleanup() {
  sweep().catch(() => {});
  const timer = setInterval(() => { sweep().catch(() => {}); }, 5 * 60_000);
  timer.unref();
  return timer;
}

/** Clears everything on boot, so a restart never serves stale files. */
export async function purgeOnStart() {
  try {
    const entries = await fsp.readdir(config.downloadDir, { withFileTypes: true });
    await Promise.all(
      entries
        .filter((e) => e.isDirectory())
        .map((e) => fsp.rm(path.join(config.downloadDir, e.name), { recursive: true, force: true })),
    );
  } catch { /* nothing to clear */ }
}
