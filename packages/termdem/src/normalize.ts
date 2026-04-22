import { stripVTControlCharacters } from "node:util";
import type { NormalizeExecCaptureOptions, NormalizedExecCapture } from "./types.ts";

const execMarkerPattern = new RegExp(String.raw`\u001ETD_(?:BEGIN|END):[^\u001E]*\u001E`, "gu");

export function normalizeExecCapture(
  raw: string,
  options: NormalizeExecCaptureOptions = {},
): NormalizedExecCapture {
  const markerless = raw.replaceAll(execMarkerPattern, "");
  const controlStripped = stripVTControlCharacters(markerless);
  const normalizedLines = controlStripped
    .replaceAll("\r\n", "\n")
    .split("\n")
    .map((line) => collapseCarriageReturns(line));

  const lines = trimTrailingEmptyLines(stripTrailingPrompt(normalizedLines, options.promptPattern));
  return {
    raw,
    text: lines.join("\n"),
    lines,
  };
}

function collapseCarriageReturns(line: string) {
  if (!line.includes("\r")) {
    return line;
  }

  const segments = line.split("\r");
  return segments[segments.length - 1] ?? "";
}

function stripTrailingPrompt(lines: string[], promptPattern?: RegExp) {
  if (!promptPattern || lines.length === 0) {
    return lines;
  }

  const lastLine = lines[lines.length - 1];
  if (!lastLine) {
    return lines;
  }

  if (matchesWholeValue(lastLine, promptPattern)) {
    return lines.slice(0, -1);
  }

  for (let start = 1; start < lastLine.length; start += 1) {
    const suffix = lastLine.slice(start);
    if (!matchesWholeValue(suffix, promptPattern)) {
      continue;
    }

    return [...lines.slice(0, -1), lastLine.slice(0, start)];
  }

  return lines;
}

function trimTrailingEmptyLines(lines: string[]) {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }

  return lines.slice(0, end);
}

function matchesWholeValue(value: string, pattern: RegExp) {
  const flags = pattern.flags.replace(/[gy]/gu, "");
  const matcher = new RegExp(pattern.source, flags);
  const match = matcher.exec(value);
  return match?.index === 0 && match[0] === value;
}
