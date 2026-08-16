import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import config from '../config.js';
import log from './log.js';

/**
 * Status lifecycle:
 *   queued -> preparing -> downloading -> processing -> packaging -> done
 *   any -> error | canceled
 */
export const TERMINAL_STATES = new Set(['done', 'error', 'canceled']);

export class Job {
  constructor(input) {
    this.id = randomUUID();
    this.createdAt = Date.now();
    this.finishedAt = null;

    this.url = input.url;
    this.platform = input.platform;
    this.platformName = input.platformName;
    this.accent = input.accent;
    this.mode = input.mode;                 // 'video' | 'audio' | 'thumbnail'
    this.request = input.request ?? {};     // raw client options, already validated

    this.title = input.title ?? 'Preparing…';
    this.subtitle = input.subtitle ?? '';
    this.thumbnail = input.thumbnail ?? null;
    this.duration = input.duration ?? null;
    this.isCollection = Boolean(input.isCollection);

    this.status = 'queued';
    this.phase = 'Waiting for a free slot';
    this.error = null;
    this.warnings = [];

    this.progress = {
      percent: null,
      downloaded: null,
      total: null,
      speed: null,
      eta: null,
      item: 0,
      itemCount: input.itemCount ?? (input.isCollection ? null : 1),
    };

    this.files = [];
    this.archive = null;
    this.dir = path.join(config.downloadDir, this.id);

    this.controller = new AbortController();
  }

  get signal() {
    return this.controller.signal;
  }

  /** Everything the browser needs; never leaks absolute paths. */
  toJSON() {
    return {
      id: this.id,
      url: this.url,
      platform: this.platform,
      platformName: this.platformName,
      accent: this.accent,
      mode: this.mode,
      title: this.title,
      subtitle: this.subtitle,
      thumbnail: this.thumbnail,
      duration: this.duration,
      isCollection: this.isCollection,
      status: this.status,
      phase: this.phase,
      error: this.error,
      warnings: this.warnings,
      progress: this.progress,
      files: this.files.map((file, index) => ({
        name: file.name,
        size: file.size,
        ext: file.ext,
        url: `/api/jobs/${this.id}/files/${index}`,
      })),
      archive: this.archive
        ? { name: this.archive.name, size: this.archive.size, url: `/api/jobs/${this.id}/archive` }
        : null,
      createdAt: this.createdAt,
      finishedAt: this.finishedAt,
    };
  }
}

class JobStore extends EventEmitter {
  constructor() {
    super();
    this.setMaxListeners(0);
    this.jobs = new Map();
  }

  create(input) {
    const job = new Job(input);
    this.jobs.set(job.id, job);
    this.emit('created', job);
    this.publish(job);
    return job;
  }

  get(id) {
    return this.jobs.get(id) ?? null;
  }

  /** Newest first, for the activity rail. */
  list(limit = 40) {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((job) => job.toJSON());
  }

  /** Applies a patch and notifies every SSE listener for this job. */
  update(job, patch = {}) {
    if (!job) return;
    if (TERMINAL_STATES.has(job.status) && patch.status && patch.status !== job.status) {
      return; // never resurrect a finished job
    }

    for (const [key, value] of Object.entries(patch)) {
      if (key === 'progress') Object.assign(job.progress, value);
      else job[key] = value;
    }

    if (patch.status && TERMINAL_STATES.has(patch.status) && !job.finishedAt) {
      job.finishedAt = Date.now();
    }

    this.publish(job);
  }

  addWarning(job, message) {
    if (!job || !message) return;
    if (job.warnings.includes(message)) return;
    job.warnings = [...job.warnings, message].slice(-8);
    this.publish(job);
  }

  publish(job) {
    const payload = job.toJSON();
    this.emit(`job:${job.id}`, payload);
    this.emit('any', payload);
  }

  cancel(id) {
    const job = this.get(id);
    if (!job || TERMINAL_STATES.has(job.status)) return false;
    job.controller.abort();
    this.update(job, { status: 'canceled', phase: 'Canceled', error: null });
    this.removeFiles(job).catch(() => {});
    return true;
  }

  async removeFiles(job) {
    try {
      await fsp.rm(job.dir, { recursive: true, force: true });
      job.files = [];
      job.archive = null;
    } catch (err) {
      log.warn(`Could not clean ${job.dir}: ${err.message}`);
    }
  }

  /**
   * Drops jobs whose files have already been removed and that are older than
   * the retention window, so a long-running server does not grow forever.
   */
  prune() {
    const cutoff = Date.now() - config.jobRetentionMinutes * 60_000;
    for (const [id, job] of this.jobs) {
      if (TERMINAL_STATES.has(job.status) && job.createdAt < cutoff) {
        this.jobs.delete(id);
      }
    }
  }
}

export const jobs = new JobStore();
export default jobs;
