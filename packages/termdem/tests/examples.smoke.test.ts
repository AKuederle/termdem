import { access, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, test } from "vite-plus/test";

const execFileAsync = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const termdemCliPath = join(repoRoot, "packages/termdem/dist/cli.mjs");

const examples = [
  {
    expectedDurationMs: 37_500,
    name: "git-vim",
    toleranceMs: 6_000,
  },
  {
    expectedDurationMs: 27_000,
    name: "socket-cli",
    toleranceMs: 5_000,
  },
] as const;

describe("example recording smoke tests", () => {
  test.each(examples)(
    "$name compiles to a video with the expected duration",
    { tags: ["smoke"], timeout: 120_000 },
    async ({ expectedDurationMs, name, toleranceMs }) => {
      const tempDir = await mkdtemp(join(tmpdir(), "termdem-smoke-"));
      const outputPath = join(tempDir, `${name}.webm`);

      try {
        await execFileAsync(
          process.execPath,
          [termdemCliPath, "record", join(repoRoot, "examples", name, "demo.tsx"), outputPath],
          {
            cwd: repoRoot,
            timeout: 110_000,
          },
        );

        await access(outputPath);
        const outputStats = await stat(outputPath);
        expect(outputStats.isFile()).toBe(true);
        expect(outputStats.size).toBeGreaterThan(10_000);

        const durationMs = await readVideoDurationMs(outputPath);
        expect(durationMs).toBeGreaterThanOrEqual(expectedDurationMs - toleranceMs);
        expect(durationMs).toBeLessThanOrEqual(expectedDurationMs + toleranceMs);
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    },
  );
});

async function readVideoDurationMs(path: string) {
  const { stdout } = await execFileAsync(
    "ffprobe",
    [
      "-v",
      "error",
      "-show_entries",
      "format=duration",
      "-of",
      "default=noprint_wrappers=1:nokey=1",
      path,
    ],
    {
      timeout: 10_000,
    },
  );
  const durationSeconds = Number.parseFloat(stdout.trim());

  if (!Number.isFinite(durationSeconds)) {
    throw new Error(`Could not read video duration from ffprobe output: ${stdout}`);
  }

  return durationSeconds * 1_000;
}
