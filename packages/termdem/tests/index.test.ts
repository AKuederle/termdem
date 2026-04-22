import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { createPaneSession, normalizeExecCapture } from "../src/index.ts";

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

async function createTempDir() {
  const path = await mkdtemp(join(tmpdir(), "termdem-"));
  cleanupPaths.push(path);
  return path;
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
