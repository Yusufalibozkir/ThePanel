// One-time metadata backfill over the existing catalog (Phase 2).
// Usage: npm run backfill-metadata [-- --force]
// Queues a backfill_metadata job; the runner executes it.

const path = require('path');
const dotenv = require('dotenv');
dotenv.config({ path: path.join(__dirname, '../.env') });

const { enqueue, get } = require('../src/services/jobService');
const jobRunner = require('../src/jobs/runner');
require('../src/jobs/handlers');

const force = process.argv.includes('--force');

const job = enqueue('backfill_metadata', { force }, { maxAttempts: 1 });

console.log(`Queued backfill_metadata job ${job.id} (force: ${force}). Running to completion...`);

(async () => {
  try {
    // Drive the runner inline instead of on a timer
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await jobRunner.runOnce();
      if (!result) break;
      const current = get(job.id);
      if (current && current.status !== 'pending') break;
    }
    const final = get(job.id);
    if (final?.status === 'done') {
      console.log('Backfill complete.');
    } else {
      console.error(`Backfill ended with status: ${final?.status} — ${final?.last_error || 'unknown'}`);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('Backfill failed:', error.message);
    process.exitCode = 1;
  }
  process.exit(process.exitCode || 0);
})();
