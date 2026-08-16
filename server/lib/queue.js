import config from '../config.js';
import jobs from './jobs.js';
import log from './log.js';

/**
 * A concurrency-limited FIFO runner.
 *
 * Downloads are network- and disk-heavy; running ten at once makes every one
 * of them slower and gets the machine rate-limited. Three at a time is a good
 * default, tunable via MAX_CONCURRENT_JOBS.
 */
class Queue {
  constructor(limit) {
    this.limit = limit;
    this.pending = [];
    this.active = new Set();
  }

  push(job, task) {
    this.pending.push({ job, task });
    this.updateQueuePositions();
    this.drain();
  }

  updateQueuePositions() {
    this.pending.forEach((entry, index) => {
      if (entry.job.status !== 'queued') return;
      jobs.update(entry.job, {
        phase: index === 0 ? 'Next in line' : `Queued · ${index + 1} ahead`,
      });
    });
  }

  drain() {
    while (this.active.size < this.limit && this.pending.length > 0) {
      const entry = this.pending.shift();
      const { job, task } = entry;

      // A job canceled while waiting never starts.
      if (job.signal.aborted || job.status === 'canceled') continue;

      this.active.add(job.id);
      jobs.update(job, { status: 'preparing', phase: 'Starting' });

      Promise.resolve()
        .then(() => task())
        .catch((err) => {
          if (job.signal.aborted || err?.canceled) {
            jobs.update(job, { status: 'canceled', phase: 'Canceled' });
          } else {
            log.error(`Job ${job.id} failed: ${err?.message ?? err}`);
            jobs.update(job, {
              status: 'error',
              phase: 'Failed',
              error: err?.message ?? 'Something went wrong.',
            });
          }
        })
        .finally(() => {
          this.active.delete(job.id);
          this.updateQueuePositions();
          this.drain();
        });
    }

    this.updateQueuePositions();
  }

  get stats() {
    return { active: this.active.size, waiting: this.pending.length, limit: this.limit };
  }
}

export const queue = new Queue(config.maxConcurrentJobs);
export default queue;
