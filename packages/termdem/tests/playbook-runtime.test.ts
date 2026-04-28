import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { PlaybookRuntime, execFileForPlaybook } from "../src/playbook-runtime.ts";
import { createPaneSession } from "../src/pane-session.ts";
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
    await session.sendLine("printf ready; sleep 30", { typeDelayMs: 0 });
    await waitFor(() => visibleOutput.join("").includes("ready"));

    const transcript = visibleOutput.join("");
    expect(transcript).toContain("printf ready; sleep 30");
    expect(transcript).toContain("ready");
  } finally {
    await session.close();
  }
});

test("execFileForPlaybook captures stdout, stderr, exit code, timeout, and reject behavior", async () => {
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

  await expect(execFileForPlaybook(process.execPath, [scriptPath, "7"], { cwd })).rejects.toThrow(
    "exited with code 7",
  );

  const result = await execFileForPlaybook(process.execPath, [scriptPath, "7"], {
    cwd,
    reject: false,
  });
  expect(result).toEqual({ exitCode: 7, stderr: "err", stdout: "out" });

  const timeout = await execFileForPlaybook(process.execPath, [scriptPath, "0"], {
    cwd,
    reject: false,
    timeoutMs: 1,
  });
  expect(timeout.exitCode).not.toBe(0);
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
