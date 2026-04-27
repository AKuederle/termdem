import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import { isCliEntrypoint, parseTermdemCliArgs, runTermdemCli } from "../src/cli.ts";
import { inferRecordingFormat } from "../src/recording-output.ts";

test("parseTermdemCliArgs parses preview commands", () => {
  expect(parseTermdemCliArgs(["preview", "demo.tsx"])).toEqual({
    command: "preview",
    demoPath: "demo.tsx",
  });
});

test("parseTermdemCliArgs parses record commands and infers webm output", () => {
  expect(parseTermdemCliArgs(["record", "demo.tsx", "demo.webm", "--size", "1920x1080"])).toEqual({
    cliOptions: {
      size: "1920x1080",
    },
    command: "record",
    demoPath: "demo.tsx",
    format: "webm",
    outputPath: "demo.webm",
  });
});

test("parseTermdemCliArgs supports separate viewport size aliases", () => {
  for (const flag of ["--viewportSize", "--viewportsize", "--viewport-size"]) {
    expect(
      parseTermdemCliArgs([
        "record",
        "demo.tsx",
        "demo.mp4",
        "--size",
        "1920x1080",
        flag,
        "1440x900",
      ]),
    ).toEqual({
      cliOptions: {
        size: "1920x1080",
        viewportSize: "1440x900",
      },
      command: "record",
      demoPath: "demo.tsx",
      format: "mp4",
      outputPath: "demo.mp4",
    });
  }
});

test("parseTermdemCliArgs rejects unknown commands and malformed record commands", () => {
  expect(() => parseTermdemCliArgs(["capture", "demo.tsx"])).toThrow('Unknown command "capture"');
  expect(() => parseTermdemCliArgs(["record", "demo.tsx"])).toThrow("Usage: termdem record");
  expect(() => parseTermdemCliArgs(["record", "demo.tsx", "demo.webm", "--size"])).toThrow(
    "Missing value for --size",
  );
  expect(() => parseTermdemCliArgs(["record", "demo.tsx", "demo.webm", "--slow"])).toThrow(
    'Unknown record option "--slow"',
  );
});

test("runTermdemCli awaits preview handlers so preview stays blocking", async () => {
  const events: string[] = [];
  let releasePreview!: () => void;
  const previewFinished = new Promise<void>((resolve) => {
    releasePreview = resolve;
  });

  const run = runTermdemCli(["preview", "demo.tsx"], {
    preview: async (command) => {
      events.push(`start:${command.demoPath}`);
      await previewFinished;
      events.push("finish");
    },
  });

  await Promise.resolve();
  expect(events).toEqual(["start:demo.tsx"]);

  releasePreview();
  await run;
  expect(events).toEqual(["start:demo.tsx", "finish"]);
});

test("runTermdemCli writes help through the injected writer", async () => {
  let output = "";

  await runTermdemCli(["help"], {
    write(text) {
      output += text;
    },
  });

  expect(output).toContain("termdem preview <demo.tsx>");
});

test("isCliEntrypoint resolves pnpm-style symlinked argv paths", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "termdem-cli-test-"));
  const targetPath = join(tempDir, "cli.mjs");
  const linkPath = join(tempDir, "termdem");

  await symlink(fileURLToPath(import.meta.url), targetPath);
  await symlink(targetPath, linkPath);

  try {
    expect(isCliEntrypoint(pathToFileURL(targetPath).href, linkPath)).toBe(true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test("inferRecordingFormat supports webm and mp4 only", () => {
  expect(inferRecordingFormat("demo.WEBM")).toBe("webm");
  expect(inferRecordingFormat("demo.mp4")).toBe("mp4");
  expect(() => inferRecordingFormat("demo.mov")).toThrow('Unsupported recording format ".mov"');
  expect(() => inferRecordingFormat("demo")).toThrow('Unsupported recording format "(none)"');
});
