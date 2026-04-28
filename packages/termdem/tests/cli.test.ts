import { mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { expect, test } from "vite-plus/test";
import {
  isCliEntrypoint,
  parseTermdemCliArgs,
  runRecordCommand,
  runTermdemCli,
} from "../src/cli.ts";
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

test("runRecordCommand records the headless preview and closes the server", async () => {
  const events: string[] = [];

  await runRecordCommand(
    {
      cliOptions: {
        size: "1920x1080",
      },
      command: "record",
      demoPath: "demo.tsx",
      format: "webm",
      outputPath: "demo.webm",
    },
    {
      async recordBrowserPage(options) {
        events.push(
          `record:${options.url}:${options.outputPath}:${options.size.width}x${options.size.height}`,
        );
      },
      async startPreviewServer(options) {
        events.push(`preview:${options.demoPath}:${options.open}`);

        return {
          demo: {
            panes: [],
            settings: {
              size: { width: 1280, height: 720 },
            },
          },
          urls: ["http://127.0.0.1:5173/"],
          async close() {
            events.push("close");
          },
        };
      },
    },
  );

  expect(events).toEqual([
    "preview:demo.tsx:false",
    "record:http://127.0.0.1:5173/:demo.webm:1920x1080",
    "close",
  ]);
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
