import { execFile } from "node:child_process";
import { copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { type DemoSize } from "./recording-config.ts";
import { inferRecordingFormat, type RecordingFormat } from "./recording-output.ts";

export type BrowserRecordingOptions = {
  doneTimeoutMs?: number;
  format?: RecordingFormat;
  onProgress?: (message: string) => void;
  outputPath: string;
  size: DemoSize;
  url: string;
  waitForDone?: (page: Page) => Promise<void>;
};

const defaultDoneTimeoutMs = 5 * 60 * 1000;
const recordingStatusIntervalMs = 5_000;

export async function recordBrowserPage(options: BrowserRecordingOptions): Promise<void> {
  const format = options.format ?? inferRecordingFormat(options.outputPath);
  const tempDir = await mkdtemp(join(tmpdir(), "termdem-recording-"));
  const rawVideoPath = join(tempDir, "termdem-recording.raw.webm");
  let browser: Browser | null = null;

  try {
    options.onProgress?.("Launching Chromium");
    browser = await chromium.launch({
      executablePath: process.env.TERMDEM_CHROMIUM_EXECUTABLE_PATH,
      headless: true,
    });
    const context = await browser.newContext({
      viewport: options.size,
    });
    const page = await context.newPage();
    options.onProgress?.("Loading preview");
    await page.goto(recordingUrl(options.url));

    options.onProgress?.("Waiting for terminal panes");
    await waitForRecordingReady(page);
    options.onProgress?.("Running demo setup");
    await prepareRecordingDemo(page);
    await waitForRecordingPrepared(page, options);
    options.onProgress?.("Starting browser recording");
    await page.screencast.start({
      path: rawVideoPath,
      size: options.size,
    });
    options.onProgress?.("Running demo script");
    try {
      await startRecordingDemo(page);
      await waitForRecordingDone(page, options);
    } finally {
      options.onProgress?.("Stopping browser recording");
      await page.screencast.stop();
    }

    if (
      videoNeedsTranscode({
        format,
      })
    ) {
      options.onProgress?.("Transcoding recording");
      await transcodeWebm(rawVideoPath, options.outputPath, {
        format,
        size: options.size,
      });
    } else {
      await copyFile(rawVideoPath, options.outputPath);
    }
    options.onProgress?.(`Wrote ${options.outputPath}`);
  } finally {
    await browser?.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function videoNeedsTranscode(options: { format: RecordingFormat }) {
  return options.format !== "webm";
}

export function buildFfmpegTranscodeArgs(
  inputPath: string,
  outputPath: string,
  size: DemoSize,
  options: {
    format?: RecordingFormat;
  } = {},
) {
  const format = options.format ?? inferRecordingFormat(outputPath);
  const videoFilter = [
    `scale=${size.width}:${size.height}:force_original_aspect_ratio=decrease`,
    `pad=${size.width}:${size.height}:(ow-iw)/2:(oh-ih)/2:color=black`,
    "setsar=1",
  ].join(",");

  const args = ["-y", "-i", inputPath, "-vf", videoFilter];

  if (format === "mp4") {
    args.push("-c:v", "libx264", "-movflags", "+faststart", "-pix_fmt", "yuv420p");
  } else {
    args.push("-c:v", "libvpx", "-pix_fmt", "yuv420p");
  }

  args.push(outputPath);
  return args;
}

function recordingUrl(url: string) {
  const parsed = new URL(url);
  parsed.searchParams.set("termdem_autostart", "0");
  parsed.searchParams.set("termdem_embedded", "1");
  return parsed.toString();
}

async function waitForRecordingReady(page: Page) {
  await page.waitForFunction(
    () => globalThis.__termdem?.recording?.ready === true || globalThis.__termdem?.recording?.error,
  );
  await throwIfRecordingErrored(page);
}

async function startRecordingDemo(page: Page) {
  await page.evaluate(() => {
    globalThis.__termdem?.controls?.start?.();
  });
}

async function prepareRecordingDemo(page: Page) {
  await page.evaluate(() => {
    globalThis.__termdem?.controls?.prepare?.();
  });
}

async function waitForRecordingPrepared(page: Page, options: BrowserRecordingOptions) {
  const timeoutMs = options.doneTimeoutMs ?? defaultDoneTimeoutMs;
  const startedAt = Date.now();

  while (true) {
    const status = await recordingStatus(page);
    if (status.prepared) {
      return;
    }

    if (status.error) {
      throw new Error(`Demo setup failed before recording: ${status.error}`);
    }

    if (recordingHasTimedOut(startedAt, Date.now(), timeoutMs)) {
      throw new Error("Timed out waiting for demo setup to finish");
    }

    await page.waitForTimeout(500);
  }
}

async function waitForRecordingDone(page: Page, options: BrowserRecordingOptions) {
  if (options.waitForDone) {
    await options.waitForDone(page);
    await throwIfRecordingErrored(page);
    return;
  }

  const timeoutMs = options.doneTimeoutMs ?? defaultDoneTimeoutMs;
  const startedAt = Date.now();
  let lastProgressAt = 0;
  let lastStatus = "";

  while (true) {
    const status = await recordingStatus(page);
    if (status.done) {
      return;
    }

    if (status.error) {
      throw new Error(`Demo script failed while recording: ${status.error}`);
    }

    const now = Date.now();
    const action = status.action ? `: ${status.action}` : "";
    const nextStatus = `Running demo script${action}`;
    if (nextStatus !== lastStatus || now - lastProgressAt >= recordingStatusIntervalMs) {
      options.onProgress?.(nextStatus);
      lastProgressAt = now;
      lastStatus = nextStatus;
    }

    if (recordingHasTimedOut(startedAt, now, timeoutMs)) {
      throw new Error(`Timed out waiting for demo script to finish${action}`);
    }

    await page.waitForTimeout(500);
  }
}

async function throwIfRecordingErrored(page: Page) {
  const { error } = await recordingStatus(page);
  if (error) {
    throw new Error(`Demo script failed while recording: ${error}`);
  }
}

async function recordingStatus(page: Page) {
  return page.evaluate(() => ({
    action: globalThis.__termdem?.recording?.action,
    done: globalThis.__termdem?.recording?.done === true,
    error: globalThis.__termdem?.recording?.error,
    prepared: globalThis.__termdem?.recording?.prepared === true,
  }));
}

export function recordingHasTimedOut(startedAt: number, now: number, timeoutMs: number) {
  return timeoutMs > 0 && now - startedAt >= timeoutMs;
}

async function transcodeWebm(
  inputPath: string,
  outputPath: string,
  options: {
    format: RecordingFormat;
    size: DemoSize;
  },
) {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      buildFfmpegTranscodeArgs(inputPath, outputPath, options.size, {
        format: options.format,
      }),
      (error) => {
        if (!error) {
          resolve();
          return;
        }

        if ("code" in error && error.code === "ENOENT") {
          reject(
            new Error(
              "Recording with MP4 output requires ffmpeg, but ffmpeg was not found on PATH.",
            ),
          );
          return;
        }

        reject(error);
      },
    );
  });
}

declare global {
  // eslint-disable-next-line no-var
  var __termdem:
    | {
        controls?: {
          prepare?: () => void;
          restart?: () => void;
          start?: () => void;
          stop?: () => void;
        };
        recording?: {
          action?: string;
          done?: boolean;
          error?: string;
          prepared?: boolean;
          ready?: boolean;
        };
      }
    | undefined;
}
