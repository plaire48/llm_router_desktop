export async function withRetry(task, { retries = 2, signal, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  if (!Number.isInteger(retries) || retries < 0 || retries > 5) throw Error('invalid_retries');
  for (let attempt = 0; ; attempt++) {
    signal?.throwIfAborted();
    try { return await task(attempt); }
    catch (error) {
      if (!error.retryable || attempt >= retries) throw error;
      await sleep(100 * 2 ** attempt);
    }
  }
}
