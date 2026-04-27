import { expect, test } from "vite-plus/test";
import {
  buildFfmpegTranscodeArgs,
  sizesMatch,
  videoNeedsTranscode,
} from "../src/browser-recorder.ts";

test("browser recordings use the viewport as the raw Playwright video size", () => {
  expect(
    videoNeedsTranscode({
      format: "webm",
      size: { width: 1920, height: 1080 },
      viewportSize: { width: 1440, height: 900 },
    }),
  ).toBe(true);

  expect(
    videoNeedsTranscode({
      format: "webm",
      size: { width: 1280, height: 720 },
      viewportSize: { width: 1280, height: 720 },
    }),
  ).toBe(false);
});

test("mp4 recordings are transcoded even when dimensions already match", () => {
  expect(
    videoNeedsTranscode({
      format: "mp4",
      size: { width: 1280, height: 720 },
      viewportSize: { width: 1280, height: 720 },
    }),
  ).toBe(true);
});

test("recording pre-roll forces transcoding so early blank frames can be trimmed", () => {
  expect(
    videoNeedsTranscode({
      format: "webm",
      size: { width: 1280, height: 720 },
      trimStartSeconds: 0.35,
      viewportSize: { width: 1280, height: 720 },
    }),
  ).toBe(true);
});

test("buildFfmpegTranscodeArgs preserves aspect ratio and pads to the requested output size", () => {
  expect(sizesMatch({ width: 1440, height: 900 }, { width: 1440, height: 900 })).toBe(true);
  expect(sizesMatch({ width: 1440, height: 900 }, { width: 1920, height: 1080 })).toBe(false);

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
  expect(
    buildFfmpegTranscodeArgs(
      "input.webm",
      "output.webm",
      { width: 1280, height: 720 },
      {
        trimStartSeconds: 0.35,
      },
    ),
  ).toContain(
    "trim=start=0.350,setpts=PTS-STARTPTS,scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1",
  );
});
