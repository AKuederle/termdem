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

const examples = ["git-vim", "socket-cli"] as const;

describe("example recording smoke tests", () => {
  test.each(examples)(
    "%s compiles to a webm video",
    { tags: ["smoke"], timeout: 120_000 },
    async (name) => {
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
      } finally {
        await rm(tempDir, { force: true, recursive: true });
      }
    },
  );
});
