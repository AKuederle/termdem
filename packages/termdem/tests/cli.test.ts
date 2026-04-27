import { expect, test } from "vite-plus/test";
import { parseTermdemCliArgs } from "../src/cli.ts";
import { inferRecordingFormat } from "../src/index.ts";

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

test("inferRecordingFormat supports webm and mp4 only", () => {
  expect(inferRecordingFormat("demo.WEBM")).toBe("webm");
  expect(inferRecordingFormat("demo.mp4")).toBe("mp4");
  expect(() => inferRecordingFormat("demo.mov")).toThrow('Unsupported recording format ".mov"');
  expect(() => inferRecordingFormat("demo")).toThrow('Unsupported recording format "(none)"');
});
