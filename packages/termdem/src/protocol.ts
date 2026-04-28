import type { ExecResult, PressKey } from "./types.ts";

export type PaneInputMessage = {
  type: "pane.input";
  id?: string;
  pane: string;
  data: string;
};

export type PaneResizeMessage = {
  type: "pane.resize";
  id?: string;
  pane: string;
  cols: number;
  rows: number;
};

export type PaneTypeMessage = {
  type: "pane.type";
  id?: string;
  pane: string;
  text: string;
  delayMs?: number;
};

export type PanePressMessage = {
  type: "pane.press";
  id?: string;
  pane: string;
  key: PressKey;
};

export type PaneExecMessage = {
  type: "pane.exec";
  pane: string;
  command: string;
  typeDelayMs?: number;
};

export type PaneClientMessage =
  | PaneInputMessage
  | PaneResizeMessage
  | PaneTypeMessage
  | PanePressMessage
  | PaneExecMessage;

export type PaneMetaMessage = {
  type: "pane.meta";
  pane: string;
  shell: string;
  cwd: string;
  prompt: string;
};

export type PaneOutputMessage = {
  type: "pane.output";
  pane: string;
  data: string;
};

export type PaneExecCompletedMessage = {
  type: "pane.exec.completed";
  pane: string;
  result: ExecResult;
};

export type PaneActionCompletedMessage = {
  type: "pane.action.completed";
  pane: string;
  id: string;
};

export type PaneExitMessage = {
  type: "pane.exit";
  pane: string;
  exitCode: number | null;
  signal: number | null;
};

export type PaneErrorMessage = {
  type: "pane.error";
  pane: string;
  message: string;
};

export type PaneServerMessage =
  | PaneMetaMessage
  | PaneOutputMessage
  | PaneActionCompletedMessage
  | PaneExecCompletedMessage
  | PaneExitMessage
  | PaneErrorMessage;

export function parsePaneClientMessage(raw: string): PaneClientMessage | null {
  const payload = parseObject(raw);
  if (!payload) {
    return null;
  }

  if (!isPaneName(payload.pane) || typeof payload.type !== "string") {
    return null;
  }

  switch (payload.type) {
    case "pane.input":
      if (typeof payload.data !== "string") {
        return null;
      }
      return {
        type: "pane.input",
        id: optionalString(payload.id),
        pane: payload.pane,
        data: payload.data,
      };
    case "pane.resize":
      if (typeof payload.cols !== "number" || typeof payload.rows !== "number") {
        return null;
      }
      return {
        type: "pane.resize",
        id: optionalString(payload.id),
        pane: payload.pane,
        cols: payload.cols,
        rows: payload.rows,
      };
    case "pane.type":
      if (typeof payload.text !== "string") {
        return null;
      }
      if (payload.delayMs !== undefined && typeof payload.delayMs !== "number") {
        return null;
      }
      return {
        type: "pane.type",
        id: optionalString(payload.id),
        pane: payload.pane,
        text: payload.text,
        delayMs: payload.delayMs,
      };
    case "pane.press":
      if (payload.key !== "Enter" && payload.key !== "\r") {
        return null;
      }
      return {
        type: "pane.press",
        id: optionalString(payload.id),
        pane: payload.pane,
        key: payload.key,
      };
    case "pane.exec":
      if (typeof payload.command !== "string") {
        return null;
      }
      if (payload.typeDelayMs !== undefined && typeof payload.typeDelayMs !== "number") {
        return null;
      }
      return {
        type: "pane.exec",
        pane: payload.pane,
        command: payload.command,
        typeDelayMs: payload.typeDelayMs,
      };
    default:
      return null;
  }
}

export function parsePaneServerMessage(raw: string): PaneServerMessage | null {
  const payload = parseObject(raw);
  if (!payload) {
    return null;
  }

  if (!isPaneName(payload.pane) || typeof payload.type !== "string") {
    return null;
  }

  switch (payload.type) {
    case "pane.meta":
      if (
        typeof payload.shell !== "string" ||
        typeof payload.cwd !== "string" ||
        typeof payload.prompt !== "string"
      ) {
        return null;
      }
      return {
        type: "pane.meta",
        pane: payload.pane,
        shell: payload.shell,
        cwd: payload.cwd,
        prompt: payload.prompt,
      };
    case "pane.output":
      if (typeof payload.data !== "string") {
        return null;
      }
      return {
        type: "pane.output",
        pane: payload.pane,
        data: payload.data,
      };
    case "pane.exec.completed":
      if (!isExecResult(payload.result)) {
        return null;
      }
      return {
        type: "pane.exec.completed",
        pane: payload.pane,
        result: payload.result,
      };
    case "pane.action.completed":
      if (typeof payload.id !== "string") {
        return null;
      }
      return {
        type: "pane.action.completed",
        pane: payload.pane,
        id: payload.id,
      };
    case "pane.exit":
      if (!isNullableNumber(payload.exitCode) || !isNullableNumber(payload.signal)) {
        return null;
      }
      return {
        type: "pane.exit",
        pane: payload.pane,
        exitCode: payload.exitCode,
        signal: payload.signal,
      };
    case "pane.error":
      if (typeof payload.message !== "string") {
        return null;
      }
      return {
        type: "pane.error",
        pane: payload.pane,
        message: payload.message,
      };
    default:
      return null;
  }
}

function parseObject(raw: string) {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) {
      return null;
    }

    return parsed;
  } catch {
    return null;
  }
}

function isPaneName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isExecResult(value: unknown): value is ExecResult {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.command === "string" &&
    typeof value.exitCode === "number" &&
    typeof value.raw === "string" &&
    typeof value.text === "string" &&
    Array.isArray(value.lines) &&
    value.lines.every((line) => typeof line === "string") &&
    typeof value.startedAt === "number" &&
    typeof value.endedAt === "number"
  );
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || typeof value === "number";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
