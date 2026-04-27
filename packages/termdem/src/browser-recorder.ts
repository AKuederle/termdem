import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { type DemoSize } from "./recording-config.ts";
import { inferRecordingFormat, type RecordingFormat } from "./recording-output.ts";

export type BrowserRecordingOptions = {
  doneTimeoutMs?: number;
  format?: RecordingFormat;
  outputPath: string;
  size: DemoSize;
  url: string;
  viewportSize: DemoSize;
  waitForDone?: (page: Page) => Promise<void>;
};

const defaultDoneTimeoutMs = 5 * 60 * 1000;

export async function recordBrowserPage(options: BrowserRecordingOptions): Promise<void> {
  const format = options.format ?? inferRecordingFormat(options.outputPath);
  const tempDir = await mkdtemp(join(tmpdir(), "termdem-recording-"));
  const nativeVideoPath =
    format === "webm" ? options.outputPath : join(tempDir, "termdem-recording.webm");
  let browser: Browser | null = null;

  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      recordVideo: {
        dir: tempDir,
        size: options.size,
      },
      viewport: options.viewportSize,
    });
    const page = await context.newPage();
    await page.goto(options.url);

    const video = page.video();
    if (!video) {
      throw new Error("Playwright did not create a video for the recording page.");
    }

    await waitForRecordingDone(page, options);
    await context.close();
    await video.saveAs(nativeVideoPath);

    if (format === "mp4") {
      await transcodeWebmToMp4(nativeVideoPath, options.outputPath);
    }
  } finally {
    await browser?.close();
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function waitForRecordingDone(page: Page, options: BrowserRecordingOptions) {
  if (options.waitForDone) {
    await options.waitForDone(page);
    return;
  }

  await page.waitForFunction(() => globalThis.__termdem?.recording?.done === true, null, {
    timeout: options.doneTimeoutMs ?? defaultDoneTimeoutMs,
  });
}

async function transcodeWebmToMp4(inputPath: string, outputPath: string) {
  await new Promise<void>((resolve, reject) => {
    execFile(
      "ffmpeg",
      ["-y", "-i", inputPath, "-movflags", "+faststart", "-pix_fmt", "yuv420p", outputPath],
      (error) => {
        if (!error) {
          resolve();
          return;
        }

        if ("code" in error && error.code === "ENOENT") {
          reject(new Error("MP4 recording requires ffmpeg, but ffmpeg was not found on PATH."));
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
        recording?: {
          done?: boolean;
        };
      }
    | undefined;
}
