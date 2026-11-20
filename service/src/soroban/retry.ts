/**
 * Soroban RPC (at least the public testnet endpoint) is intermittently
 * flaky in ways that show up as either a connection timeout or a
 * cleanly-returned-but-wrong empty result (e.g. "account not found"
 * for an account that demonstrably exists). Retrying a few times with
 * backoff absorbs that without masking a genuinely bad request —
 * callers should only wrap calls here where a transient failure is
 * expected to resolve itself, not business-logic errors.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options: { attempts?: number; delayMs?: number } = {},
): Promise<T> {
  const attempts = options.attempts ?? 3;
  const delayMs = options.delayMs ?? 1000;

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs * attempt));
      }
    }
  }
  throw lastError;
}
