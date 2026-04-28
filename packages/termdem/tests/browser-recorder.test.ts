import { expect, test } from "vite-plus/test";
import {
  buildFfmpegTranscodeArgs,
  recordingHasTimedOut,
  videoNeedsTranscode,
} from "../src/browser-recorder.ts";

test("webm recordings use the raw Playwright video without ffmpeg", () => {
  expect(
    videoNeedsTranscode({
      format: "webm",
    }),
  ).toBe(false);

  expect(videoNeedsTranscode({ format: "mp4" })).toBe(true);
});

test("buildFfmpegTranscodeArgs preserves aspect ratio and pads to the requested output size", () => {
  expect(
    buildFfmpegTranscodeArgs("input.webm", "output.webm", { width: 1920, height: 1080 }),
  ).toEqual([
    "-y",
    "-i",
    "input.webm",
    "-vf",
    "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
    "-c:v",
    "libvpx",
    "-pix_fmt",
    "yuv420p",
    "output.webm",
  ]);

  expect(
    buildFfmpegTranscodeArgs("input.webm", "output.mp4", { width: 1920, height: 1080 }),
  ).toContain("+faststart");
});

test("recording timeout value of zero disables the done timeout", () => {
  expect(recordingHasTimedOut(1_000, 61_000, 0)).toBe(false);
  expect(recordingHasTimedOut(1_000, 61_000, 60_000)).toBe(true);
});
