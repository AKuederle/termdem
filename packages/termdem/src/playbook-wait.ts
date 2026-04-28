export type PlaybookWaitDependencies = {
  now?: () => number;
  sleep?: (delayMs: number) => Promise<void>;
};

const waitTickMs = 25;

export async function waitForPlaybookDelay(
  delayMs: number,
  waitForPlaybookActive: () => Promise<void>,
  dependencies: PlaybookWaitDependencies = {},
) {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new Error(`Invalid wait duration ${delayMs}`);
  }

  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? sleepFor;
  let remainingMs = delayMs;

  while (remainingMs > 0) {
    await waitForPlaybookActive();

    const tickMs = Math.min(waitTickMs, remainingMs);
    const startedAt = now();
    await sleep(tickMs);
    remainingMs -= Math.max(0, now() - startedAt);
  }

  await waitForPlaybookActive();
}

async function sleepFor(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
