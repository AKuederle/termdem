import { stripVTControlCharacters } from "node:util";

export type PressKey = "Enter";

export type TypeOptions = {
  delayMs?: number;
};

export type ExecOptions = {
  typeDelayMs?: number;
};

export type ExecResult = {
  command: string;
  exitCode: number;
  raw: string;
  text: string;
  lines: string[];
  startedAt: number;
  endedAt: number;
};

export interface PaneController {
  type(text: string, options?: TypeOptions): Promise<void>;
  press(key: PressKey): Promise<void>;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
}

export type NormalizeExecCaptureOptions = {
  promptPattern?: RegExp;
};

export type NormalizedExecCapture = {
  raw: string;
  text: string;
  lines: string[];
};

const execMarkerPattern = /\u001eTD_(?:BEGIN|END):[^\u001e]*\u001e/gu;

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
  if (!lastLine || !promptPattern.test(lastLine)) {
    return lines;
  }

  return lines.slice(0, -1);
}

function trimTrailingEmptyLines(lines: string[]) {
  let end = lines.length;
  while (end > 0 && lines[end - 1] === "") {
    end -= 1;
  }

  return lines.slice(0, end);
}
