import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { keys } from "../src/keys.ts";
import { PlaybookRuntime } from "../src/playbook-runtime.ts";
import { createPaneSession } from "../src/pane-session.ts";
import type { NodeExecResult } from "../src/types.ts";
import { TmpDir } from "../src/workspace.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("pane sessions sendLine visibly starts a command without waiting for prompt", async () => {
  const visibleOutput: string[] = [];
  const session = await createPaneSession({
    onOutput(chunk) {
      visibleOutput.push(chunk);
    },
  });

  try {
    const sent = session.sendLine("printf ready; sleep 1; printf fin%shed is", {
      typeDelayMs: 0,
    });
    await expect(
      Promise.race([sent.then(() => "sent" as const), sleep(200).then(() => "waiting" as const)]),
    ).resolves.toBe("sent");
    await waitFor(() => visibleOutput.join("").includes("ready"));

    const transcript = visibleOutput.join("");
    expect(transcript).toContain("printf ready; sleep 1; printf fin%shed is");
    expect(transcript).toContain("ready");
    await waitFor(() => visibleOutput.join("").includes("finished"));
  } finally {
    await session.close();
  }
});

test("node exec captures stdout, stderr, exit code, timeout, and reject behavior", async () => {
  const cwd = await createTempDir();
  const scriptPath = join(cwd, "probe.mjs");
  await writeFile(
    scriptPath,
    [
      "process.stdout.write('out');",
      "process.stderr.write('err');",
      "setTimeout(() => process.exit(Number(process.argv[2])), 20);",
    ].join("\n"),
    "utf8",
  );
  const runtime = new PlaybookRuntime({
    terminalDefinitions: [{ name: "main", pwd: new TmpDir({}) }],
    typeDelayMs: 0,
  });
  let rejectionMessage = "";
  let result: NodeExecResult | undefined;
  let timeoutResult: NodeExecResult | undefined;

  await runtime.run(async (api) => {
    try {
      await api.node.exec(process.execPath, [scriptPath, "7"], { cwd });
    } catch (error) {
      rejectionMessage = error instanceof Error ? error.message : String(error);
    }

    result = await api.node.exec(process.execPath, [scriptPath, "7"], {
      cwd,
      reject: false,
    });

    timeoutResult = await api.node.exec(process.execPath, [scriptPath, "0"], {
      cwd,
      reject: false,
      timeoutMs: 1,
    });
  });

  expect(rejectionMessage).toContain("exited with code 7");
  expect(result).toEqual({ exitCode: 7, stderr: "err", stdout: "out" });
  expect(timeoutResult).toBeDefined();
  expect(timeoutResult?.exitCode).not.toBe(0);
});

test("playbook runtime retries waitFor probes and reports timeout labels", async () => {
  const runtime = new PlaybookRuntime({
    terminalDefinitions: [{ name: "main", pwd: new TmpDir({}) }],
    typeDelayMs: 0,
  });
  let attempts = 0;

  await runtime.waitFor(
    "probe ready",
    async () => {
      attempts += 1;
      return attempts === 3;
    },
    { intervalMs: 1, timeoutMs: 100 },
  );

  await expect(
    runtime.waitFor("never ready", async () => false, { intervalMs: 1, timeoutMs: 5 }),
  ).rejects.toThrow('Timed out waiting for "never ready"');
});

test("playbook runtime exposes pane cwd after visible commands change it", async () => {
  const runtime = new PlaybookRuntime({
    terminalDefinitions: [{ name: "main", pwd: new TmpDir({}) }],
    typeDelayMs: 0,
  });

  await runtime.run(async (api) => {
    const pane = api.pane("main");
    const initialCwd = await pane.cwd();

    await pane.exec("mkdir nested && cd nested");

    expect(await pane.cwd()).toBe(join(initialCwd, "nested"));
  });
});

test("playbook runtime runs hidden lifecycle hooks around the visible script", async () => {
  const states: string[] = [];
  const visibleOutput: string[] = [];
  const teardownData: string[] = [];
  const runtime = new PlaybookRuntime({
    onPaneOutput(message) {
      visibleOutput.push(message.data);
    },
    onPlaybookState(state) {
      states.push(state.state);
    },
    terminalDefinitions: [{ name: "main", pwd: new TmpDir({}) }],
    typeDelayMs: 50,
  });

  await runtime.run(
    async (api, setupData: { message: string }) => {
      expect(setupData).toEqual({ message: "hidden setup output" });
      const result = await api.pane("main").exec("printf visible-script", { typeDelayMs: 0 });
      expect(result.text).toBe("visible-script");
    },
    {
      setup: async (api) => {
        const result = await api.pane("main").exec("printf 'hidden setup output'");
        await api.pane("main").sendLine("printf hidden-sendline");
        await api.pane("main").type("printf hidden-type");
        await api.pane("main").press("Enter");
        await api.pane("main").type("printf hidden-type-enter\r");
        await api.pane("main").type("printf hidden-multi-a\rprintf hidden-multi-b\r");
        await api
          .pane("main")
          .type(
            "printf '(main) $ (main) $ hidden-prompt-string'\rprintf hidden-after-prompt-string\r",
          );
        await api.pane("main").press(keys.CTRL_L);
        await api.pane("main").press(keys.ESC);
        await api.pane("main").press("Enter");
        await api.pane("main").exec("true");
        return { message: result.text };
      },
      teardown: async (api, setupData) => {
        expect(states).not.toContain("done");
        teardownData.push(setupData.message);
        await api.pane("main").exec("printf hidden-teardown");
      },
    },
  );

  const transcript = visibleOutput.join("");
  expect(transcript).toContain("printf visible-script");
  expect(transcript).toContain("visible-script");
  expect(transcript).not.toContain("hidden setup output");
  expect(transcript).not.toContain("hidden-sendline");
  expect(transcript).not.toContain("hidden-type");
  expect(transcript).not.toContain("hidden-type-enter");
  expect(transcript).not.toContain("hidden-multi-a");
  expect(transcript).not.toContain("hidden-multi-b");
  expect(transcript).not.toContain("hidden-prompt-string");
  expect(transcript).not.toContain("hidden-after-prompt-string");
  expect(transcript).not.toContain("hidden-teardown");
  expect(transcript).not.toContain("\x1b[H");
  expect(states).toContain("done");
  expect(teardownData).toEqual(["hidden setup output"]);
});

test("playbook runtime cancellation prevents stale playbook completion", async () => {
  const states: string[] = [];
  const runtime = new PlaybookRuntime({
    onPlaybookState(state) {
      states.push(state.state);
    },
    terminalDefinitions: [{ name: "main", pwd: new TmpDir({}) }],
    typeDelayMs: 0,
  });

  const first = runtime.run(async (api) => {
    await api.wait(50);
  });
  runtime.stop();
  await first;

  expect(states).toContain("running");
  expect(states).toContain("stopped");
  expect(states).not.toContain("done");
});

test("playbook runtime pause blocks wait until resume without cancelling the run", async () => {
  const states: string[] = [];
  const runtime = new PlaybookRuntime({
    onPlaybookState(state) {
      states.push(state.state);
    },
    terminalDefinitions: [{ name: "main", pwd: new TmpDir({}) }],
    typeDelayMs: 0,
  });
  let completed = false;

  const run = runtime.run(async (api) => {
    await api.wait(50);
    completed = true;
  });

  await waitFor(() => states.includes("running"));
  runtime.pause();
  await sleep(100);

  expect(completed).toBe(false);
  expect(states).toContain("paused");

  runtime.resume();
  await run;

  expect(completed).toBe(true);
  expect(states.at(-1)).toBe("done");
});

test("playbook runtime stop cancels a paused run", async () => {
  const states: string[] = [];
  const runtime = new PlaybookRuntime({
    onPlaybookState(state) {
      states.push(state.state);
    },
    terminalDefinitions: [{ name: "main", pwd: new TmpDir({}) }],
    typeDelayMs: 0,
  });
  let completed = false;

  const run = runtime.run(async (api) => {
    await api.wait(5_000);
    completed = true;
  });

  await waitFor(() => states.includes("running"));
  runtime.pause();
  await waitFor(() => states.includes("paused"));
  runtime.stop();
  await run;

  expect(completed).toBe(false);
  expect(states).toContain("stopped");
  expect(states).not.toContain("done");
});

test("playbook runtime ignores overlapping start requests", async () => {
  const runtime = new PlaybookRuntime({
    terminalDefinitions: [{ name: "main", pwd: new TmpDir({}) }],
    typeDelayMs: 0,
  });
  let starts = 0;
  let release!: () => void;
  const started = new Promise<void>((resolve) => {
    release = resolve;
  });

  const first = runtime.run(async () => {
    starts += 1;
    await started;
  });
  const second = runtime.run(async () => {
    starts += 1;
  });

  release();
  await Promise.all([first, second]);

  expect(starts).toBe(1);
});

async function createTempDir() {
  const path = await mkdtemp(join(tmpdir(), "termdem-runtime-test-"));
  cleanupPaths.push(path);
  return path;
}

async function waitFor(assertion: () => boolean, timeoutMs = 2_000) {
  const start = Date.now();

  while (!assertion()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("Timed out waiting for assertion");
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

async function sleep(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
