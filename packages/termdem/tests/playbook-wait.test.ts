import { expect, test } from "vite-plus/test";
import { waitForPlaybookDelay } from "../src/playbook-wait.ts";

test("playbook wait delays for the requested active time", async () => {
  let now = 0;
  const sleeps: number[] = [];

  await waitForPlaybookDelay(75, async () => {}, {
    now: () => now,
    sleep: async (delayMs) => {
      sleeps.push(delayMs);
      now += delayMs;
    },
  });

  expect(now).toBe(75);
  expect(sleeps).toEqual([25, 25, 25]);
});

test("playbook wait does not count time spent waiting for resume", async () => {
  let now = 0;
  let activeChecks = 0;

  await waitForPlaybookDelay(
    50,
    async () => {
      activeChecks += 1;
      if (activeChecks === 2) {
        now += 1_000;
      }
    },
    {
      now: () => now,
      sleep: async (delayMs) => {
        now += delayMs;
      },
    },
  );

  expect(now).toBe(1_050);
});
