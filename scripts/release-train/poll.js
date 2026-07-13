/**
 * Shared poll-until-deadline helper for release train scripts.
 * Replaces the ad-hoc `while (Date.now() < deadline) { ...; await waitMs(...) }`
 * loops previously duplicated in wait-ci.js, wait-release-please.js and wait-npm.js.
 */

export function waitMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Repeatedly calls `check()` until it returns a truthy "done" result or the
 * timeout elapses. `check` receives the elapsed attempt index (1-based) and
 * may be async. Returns whatever `check` returned on success.
 *
 * @param {Object} opts
 * @param {number} opts.timeoutMin - overall timeout in minutes
 * @param {number} opts.intervalS - delay between attempts in seconds
 * @param {(attempt: number) => Promise<any>|any} opts.check - returns a
 *   truthy value (other than `undefined`/`false`/`null`) to stop polling.
 * @param {() => Error} [opts.onTimeout] - builds the error thrown on timeout.
 * @param {boolean} [opts.immediate] - if true, sleep only after a failed
 *   attempt (default); if false, sleep before the first check as well.
 */
export async function pollUntil({
  timeoutMin,
  intervalS,
  check,
  onTimeout,
  immediate = true,
}) {
  const deadline = Date.now() + timeoutMin * 60 * 1000;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt += 1;
    if (!immediate && attempt === 1) {
      await waitMs(intervalS * 1000);
    }
    const result = await check(attempt);
    if (result) return result;
    await waitMs(intervalS * 1000);
  }

  throw onTimeout ? onTimeout() : new Error(`Polling timed out after ${timeoutMin}m`);
}
