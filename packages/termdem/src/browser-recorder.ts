import { execFile } from "node:child_process";
import { mkdtemp, rename, rm } from "node:fs/promises";
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
  viewportSize: DemoSize;
  waitForDone?: (page: Page) => Promise<void>;
};

const defaultDoneTimeoutMs = 5 * 60 * 1000;
const recordingLeadInMs = 500;

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
      recordVideo: {
        dir: tempDir,
        size: options.viewportSize,
      },
      viewport: options.viewportSize,
    });
    const recordingStartedAt = Date.now();
    const page = await context.newPage();
    options.onProgress?.("Loading preview");
    await page.goto(recordingUrl(options.url));

    const video = page.video();
    if (!video) {
      throw new Error("Playwright did not create a video for the recording page.");
    }

    options.onProgress?.("Waiting for terminal panes");
    await waitForRecordingReady(page);
    const readyAt = Date.now();
    await page.waitForTimeout(recordingLeadInMs);
    const trimStartSeconds = Math.max(0, (readyAt - recordingStartedAt) / 1000 - 0.05);
    options.onProgress?.("Running demo script");
    await startRecordingDemo(page);
    await waitForRecordingDone(page, options);
    options.onProgress?.("Saving raw browser recording");
    await context.close();
    await video.saveAs(rawVideoPath);

    if (
      videoNeedsTranscode({
        format,
        size: options.size,
        trimStartSeconds,
        viewportSize: options.viewportSize,
      })
    ) {
      options.onProgress?.("Transcoding recording");
      await transcodeWebm(rawVideoPath, options.outputPath, {
        format,
        size: options.size,
        trimStartSeconds,
      });
    } else {
      await rename(rawVideoPath, options.outputPath);
    }
    options.onProgress?.(`Wrote ${options.outputPath}`);
  } finally {
    await browser?.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

export function videoNeedsTranscode(options: {
  format: RecordingFormat;
  size: DemoSize;
  trimStartSeconds?: number;
  viewportSize: DemoSize;
}) {
  return (
    options.format !== "webm" ||
    !sizesMatch(options.size, options.viewportSize) ||
    Boolean(options.trimStartSeconds && options.trimStartSeconds > 0)
  );
}

export function sizesMatch(left: DemoSize, right: DemoSize) {
  return left.width === right.width && left.height === right.height;
}

export function buildFfmpegTranscodeArgs(
  inputPath: string,
  outputPath: string,
  size: DemoSize,
  options: {
    format?: RecordingFormat;
    trimStartSeconds?: number;
  } = {},
) {
  const format = options.format ?? inferRecordingFormat(outputPath);
  const videoFilter = [
    ...(options.trimStartSeconds && options.trimStartSeconds > 0
      ? [`trim=start=${options.trimStartSeconds.toFixed(3)}`, "setpts=PTS-STARTPTS"]
      : []),
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

async function waitForRecordingDone(page: Page, options: BrowserRecordingOptions) {
  if (options.waitForDone) {
    await options.waitForDone(page);
    return;
  }

  await page.waitForFunction(
    () => globalThis.__termdem?.recording?.done === true || globalThis.__termdem?.recording?.error,
    null,
    {
      timeout: options.doneTimeoutMs ?? defaultDoneTimeoutMs,
    },
  );
  await throwIfRecordingErrored(page);
}

async function throwIfRecordingErrored(page: Page) {
  const error = await page.evaluate(() => globalThis.__termdem?.recording?.error);
  if (error) {
    throw new Error(`Demo script failed while recording: ${error}`);
  }
}

async function transcodeWebm(
  inputPath: string,
  outputPath: string,
  options: {
    format: RecordingFormat;
    size: DemoSize;
    trimStartSeconds: number;
  },
) {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      buildFfmpegTranscodeArgs(inputPath, outputPath, options.size, {
        format: options.format,
        trimStartSeconds: options.trimStartSeconds,
      }),
      (error) => {
        if (!error) {
          resolve();
          return;
        }

        if ("code" in error && error.code === "ENOENT") {
          reject(
            new Error(
              "Recording with MP4 output or different viewport/output sizes requires ffmpeg, but ffmpeg was not found on PATH.",
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
          start?: () => void;
        };
        recording?: {
          done?: boolean;
          error?: string;
          ready?: boolean;
        };
      }
    | undefined;
}
