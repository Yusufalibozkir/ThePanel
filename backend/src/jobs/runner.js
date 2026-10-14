const jobService = require('../services/jobService');

// In-process job runner. Polls the durable jobs table, executes handlers,
// applies exponential-backoff retries. Started from server.js.

const handlers = new Map();

const registerHandler = (type, handler) => {
  handlers.set(type, handler);
};

const runOnce = async () => {
  const job = jobService.claimNext();
  if (!job) return false;

  const handler = handlers.get(job.type);
  if (!handler) {
    jobService.markFailed(job, new Error(`no handler registered for job type '${job.type}'`));
    return true;
  }

  try {
    await handler(job.payload, job);
    jobService.markDone(job.id);
  } catch (error) {
    console.error(`[jobs] ${job.type} ${job.id} failed (attempt ${job.attempts}/${job.max_attempts}):`, error.message);
    jobService.markFailed(job, error);
  }
  return true;
};

const start = (intervalMs = 5000) => {
  const recovered = jobService.recoverStale();
  if (recovered > 0) {
    console.log(`[jobs] recovered ${recovered} stale running job(s) after restart`);
  }

  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      // Drain a small batch each tick so bursts don't wait one-per-5s
      for (let i = 0; i < 10; i++) {
        const didWork = await runOnce();
        if (!didWork) break;
      }
    } catch (error) {
      console.error('[jobs] runner tick error:', error);
    } finally {
      running = false;
    }
  }, intervalMs);

  timer.unref();
  console.log(`[jobs] runner started (poll every ${intervalMs / 1000}s)`);
  return timer;
};

module.exports = {
  registerHandler,
  runOnce,
  start,
};
