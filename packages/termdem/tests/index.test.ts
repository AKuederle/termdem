import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { Dir, execNode, ExecNodeError, quoteShellArg, TmpDir } from "../src/index.ts";
import { normalizeExecCapture } from "../src/normalize.ts";
import { createPaneSession } from "../src/pane-session.ts";
import { resolveRecordingConfig } from "../src/recording-config.ts";
import { createTerminalWorkspace } from "../src/workspace.ts";

const cleanupPaths: string[] = [];

afterEach(async () => {
  await Promise.all(
    cleanupPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

test("normalizeExecCapture removes markers, ansi, prompt noise, and trailing blank lines", () => {
  const result = normalizeExecCapture(
    [
      "\u001eTD_BEGIN:step-1\u001e",
      "\u001b[32mfirst.txt\u001b[0m\n",
      "loading\rloaded\n",
      "\n",
      "(alpha) /repo $ ",
      "\u001eTD_END:step-1:0\u001e",
    ].join(""),
    {
      promptPattern: /^\(alpha\) \/repo \$ $/u,
    },
  );

  expect(result.text).toBe("first.txt\nloaded");
  expect(result.lines).toEqual(["first.txt", "loaded"]);
});

test("normalizeExecCapture keeps raw text available while pruning empty trailing lines", () => {
  const raw = "README.md\nsrc\n\n\n";

  const result = normalizeExecCapture(raw);

  expect(result.raw).toBe(raw);
  expect(result.text).toBe("README.md\nsrc");
  expect(result.lines).toEqual(["README.md", "src"]);
});

test("normalizeExecCapture strips a prompt suffix from the final output line", () => {
  const result = normalizeExecCapture("alpha fileTERMDEM> ", {
    promptPattern: /^TERMDEM> $/u,
  });

  expect(result.text).toBe("alpha file");
  expect(result.lines).toEqual(["alpha file"]);
});

test("normalizeExecCapture is stable when promptPattern uses stateful regex flags", () => {
  const promptPattern = /^TERMDEM> $/gu;

  expect(
    normalizeExecCapture("TERMDEM> ", {
      promptPattern,
    }).lines,
  ).toEqual([]);
  expect(
    normalizeExecCapture("TERMDEM> ", {
      promptPattern,
    }).lines,
  ).toEqual([]);
});

test("pane sessions can type a command and press Enter against a real shell", async () => {
  const cwd = await createTempDir();
  const visibleOutput: string[] = [];
  const session = await createPaneSession({
    cwd,
    onOutput(chunk) {
      visibleOutput.push(chunk);
    },
  });

  try {
    await session.type("printf 'hello'");
    await session.press("Enter");

    await waitFor(() => visibleOutput.join("").includes("hello"));

    const transcript = visibleOutput.join("");
    expect(transcript).toContain("printf 'hello'");
    expect(transcript).toContain("hello");
  } finally {
    await session.close();
  }
});

test("pane sessions fail fast for unsupported non-bash shells", async () => {
  await expect(
    createPaneSession({
      shell: "/bin/zsh",
    }),
  ).rejects.toThrow("Only bash shells are currently supported");
});

test("pane sessions can chain exec results from ls into cat", async () => {
  const cwd = await createTempDir();
  await writeFile(join(cwd, "alpha.txt"), "alpha file\n", "utf8");
  await writeFile(join(cwd, "bravo.txt"), "bravo file\n", "utf8");

  const visibleOutput: string[] = [];
  const session = await createPaneSession({
    cwd,
    onOutput(chunk) {
      visibleOutput.push(chunk);
    },
  });

  try {
    const listing = await session.exec("command ls -1 --color=never", {
      typeDelayMs: 1,
    });

    expect(listing.lines[0]).toBe("alpha.txt");
    expect(listing.lines).toEqual(["alpha.txt", "bravo.txt"]);

    const firstFile = listing.lines[0];
    const content = await session.exec(`cat '${firstFile}'`, {
      typeDelayMs: 1,
    });

    expect(content.exitCode).toBe(0);
    expect(content.text).toBe("alpha file");

    const transcript = visibleOutput.join("");
    expect(transcript).toContain("command ls -1 --color=never");
    expect(transcript).toContain(`cat '${firstFile}'`);
    expect(transcript).toContain("alpha file");
  } finally {
    await session.close();
  }
});

test("pane sessions disable pagers so exec commands can complete in a tty", async () => {
  const cwd = await createTempDir();
  const pagerPath = join(cwd, "blocking-pager.sh");
  await writeFile(pagerPath, "#!/bin/sh\nprintf 'pager blocked\\n'\nsleep 30\n", "utf8");
  await chmod(pagerPath, 0o755);

  const previousGitPager = process.env.GIT_PAGER;
  process.env.GIT_PAGER = pagerPath;

  const session = await createPaneSession({ cwd });

  try {
    await session.exec("git init");
    await session.exec(
      "git config user.name 'termdem' && git config user.email 'demo@example.test'",
    );
    await writeFile(join(cwd, "README.md"), "hello\n", "utf8");
    await session.exec("git add README.md && git commit -m init");

    const log = await withTimeout(session.exec("git log --oneline -1"), 1_000);

    expect(log.lines[0]).toContain("init");
    expect(log.raw).not.toContain("pager blocked");
  } finally {
    if (previousGitPager === undefined) {
      delete process.env.GIT_PAGER;
    } else {
      process.env.GIT_PAGER = previousGitPager;
    }

    await session.close();
  }
});

test("quoteShellArg wraps shell arguments and escapes single quotes", () => {
  expect(quoteShellArg("alpha.txt")).toBe("'alpha.txt'");
  expect(quoteShellArg("two words")).toBe("'two words'");
  expect(quoteShellArg("it's.txt")).toBe("'it'\\''s.txt'");
  expect(quoteShellArg("")).toBe("''");
});

test("execNode executes a Node script and captures output", async () => {
  const cwd = await createTempDir();
  const scriptPath = join(cwd, "echo.mjs");
  await writeFile(
    scriptPath,
    "process.stdout.write(process.argv.slice(2).join('|')); process.stderr.write('warn');\n",
    "utf8",
  );

  const result = await execNode(scriptPath, ["alpha", "beta"]);

  expect(result).toEqual({
    exitCode: 0,
    stderr: "warn",
    stdout: "alpha|beta",
  });
});

test("execNode rejects by default and can return non-zero results", async () => {
  const cwd = await createTempDir();
  const scriptPath = join(cwd, "fail.mjs");
  await writeFile(
    scriptPath,
    "process.stdout.write('before'); process.stderr.write('failed'); process.exit(7);\n",
    "utf8",
  );

  await expect(execNode(scriptPath)).rejects.toMatchObject({
    exitCode: 7,
    stderr: "failed",
    stdout: "before",
  } satisfies Partial<ExecNodeError>);

  await expect(execNode(scriptPath, [], { reject: false })).resolves.toEqual({
    exitCode: 7,
    stderr: "failed",
    stdout: "before",
  });
});

test("resolveRecordingConfig uses CLI size for recording and viewport by default", () => {
  expect(
    resolveRecordingConfig({ size: { width: 1280, height: 720 } }, { size: "1920x1080" }),
  ).toEqual({
    size: { width: 1920, height: 1080 },
    viewportSize: { width: 1920, height: 1080 },
  });
});

test("resolveRecordingConfig supports separate viewport size overrides", () => {
  expect(
    resolveRecordingConfig(
      {
        size: { width: 1920, height: 1080 },
        viewportSize: { width: 1280, height: 720 },
      },
      {
        size: "1440x1080",
        viewportSize: "1920x1080",
      },
    ),
  ).toEqual({
    size: { width: 1440, height: 1080 },
    viewportSize: { width: 1920, height: 1080 },
  });
});

test("resolveRecordingConfig lets CLI size override demo viewport size by default", () => {
  expect(
    resolveRecordingConfig(
      {
        size: { width: 1920, height: 1080 },
        viewportSize: { width: 1440, height: 900 },
      },
      {
        size: "1280x720",
      },
    ),
  ).toEqual({
    size: { width: 1280, height: 720 },
    viewportSize: { width: 1280, height: 720 },
  });
});

test("resolveRecordingConfig falls back from demo viewport size to recording size", () => {
  expect(resolveRecordingConfig({ size: { width: 1024, height: 768 } })).toEqual({
    size: { width: 1024, height: 768 },
    viewportSize: { width: 1024, height: 768 },
  });
});

test("resolveRecordingConfig rejects invalid size flags", () => {
  expect(() => resolveRecordingConfig({}, { size: "1920-1080" })).toThrow(
    'Invalid size "1920-1080"',
  );
  expect(() => resolveRecordingConfig({}, { viewportSize: "0x1080" })).toThrow(
    'Invalid size "0x1080"',
  );
});

test("TmpDir instances can be shared by multiple terminal workspaces", async () => {
  const setupDirs: string[] = [];
  const tmpDir = new TmpDir({
    setup: async (dir) => {
      setupDirs.push(dir);
      cleanupPaths.push(dir);
      await writeFile(join(dir, "alpha.txt"), `setup ${setupDirs.length}\n`, "utf8");
    },
  });

  const first = await createTerminalWorkspace({ name: "A", pwd: tmpDir });
  const second = await createTerminalWorkspace({ name: "B", pwd: tmpDir });

  expect(first.cwd).toBe(second.cwd);
  expect(setupDirs).toEqual([first.cwd]);
  expect(await pathExists(first.cwd)).toBe(true);

  await first.dispose();
  expect(await pathExists(second.cwd)).toBe(true);

  await second.dispose();
  expect(await pathExists(first.cwd)).toBe(false);

  const next = await createTerminalWorkspace({ name: "C", pwd: tmpDir });
  expect(next.cwd).not.toBe(first.cwd);
  expect(setupDirs).toEqual([first.cwd, next.cwd]);

  await next.dispose();
});

test("Dir owns setup and cleanup for reusable non-temp workspaces", async () => {
  const cleanupDirs: string[] = [];
  const dir = new Dir(
    async () => {
      const path = await createTempDir();
      await writeFile(join(path, "marker.txt"), "managed\n", "utf8");
      return path;
    },
    async (path) => {
      cleanupDirs.push(path);
      await rm(path, { recursive: true, force: true });
    },
  );

  const first = await createTerminalWorkspace({ name: "A", pwd: dir });
  const second = await createTerminalWorkspace({ name: "B", pwd: dir });

  expect(first.cwd).toBe(second.cwd);
  expect(await readFile(join(first.cwd, "marker.txt"), "utf8")).toBe("managed\n");

  await first.dispose();
  expect(cleanupDirs).toEqual([]);
  expect(await pathExists(first.cwd)).toBe(true);

  await second.dispose();
  expect(cleanupDirs).toEqual([first.cwd]);
  expect(await pathExists(first.cwd)).toBe(false);
});

test("terminal cleanup runs before workspace disposal and is idempotent", async () => {
  const cleanupEvents: string[] = [];
  const tmpDir = new TmpDir(async (dir) => {
    cleanupPaths.push(dir);
    await writeFile(join(dir, "marker.txt"), "ready\n", "utf8");
  });

  const workspace = await createTerminalWorkspace({
    cleanup: async ({ cwd, name }) => {
      cleanupEvents.push(`${name}:${await readFile(join(cwd, "marker.txt"), "utf8")}`);
    },
    name: "A",
    pwd: tmpDir,
  });

  await workspace.dispose();
  await workspace.dispose();

  expect(cleanupEvents).toEqual(["A:ready\n"]);
  expect(await pathExists(workspace.cwd)).toBe(false);
});

async function createTempDir() {
  const path = await mkdtemp(join(tmpdir(), "termdem-"));
  cleanupPaths.push(path);
  return path;
}

async function pathExists(path: string) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitFor(assertion: () => boolean, timeoutMs = 2000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (assertion()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out after ${timeoutMs}ms`);
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
