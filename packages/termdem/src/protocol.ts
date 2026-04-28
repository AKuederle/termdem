export type PaneInputMessage = {
  type: "pane.input";
  pane: string;
  data: string;
};

export type PaneResizeMessage = {
  type: "pane.resize";
  pane: string;
  cols: number;
  rows: number;
};

export type PlaybookControlMessage = {
  type: "playbook.start" | "playbook.restart" | "playbook.stop";
};

export type BrowserToServerMessage = PaneInputMessage | PaneResizeMessage | PlaybookControlMessage;

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

export type PaneStatusMessage = {
  type: "pane.status";
  pane: string;
  status: "ready" | "closed" | "error";
  message?: string;
};

export type PlaybookStateMessage = {
  type: "playbook.state";
  state: "idle" | "running" | "stopped" | "done" | "error";
  action?: string;
  error?: string;
};

export type RecordingStateMessage = {
  type: "recording.state";
  state: "ready" | "started" | "done" | "error";
  action?: string;
  error?: string;
};

export type PreviewErrorMessage = {
  type: "preview.error";
  message: string;
};

export type PreviewResetMessage = {
  type: "preview.reset";
};

export type ServerToBrowserMessage =
  | PaneMetaMessage
  | PaneOutputMessage
  | PaneStatusMessage
  | PlaybookStateMessage
  | RecordingStateMessage
  | PreviewResetMessage
  | PreviewErrorMessage;

export function parseBrowserToServerMessage(raw: string): BrowserToServerMessage | null {
  const payload = parseObject(raw);
  if (!payload || typeof payload.type !== "string") {
    return null;
  }

  switch (payload.type) {
    case "pane.input":
      if (!isPaneName(payload.pane) || typeof payload.data !== "string") {
        return null;
      }
      return { type: "pane.input", pane: payload.pane, data: payload.data };
    case "pane.resize":
      if (
        !isPaneName(payload.pane) ||
        !isPositiveInteger(payload.cols) ||
        !isPositiveInteger(payload.rows)
      ) {
        return null;
      }
      return {
        type: "pane.resize",
        pane: payload.pane,
        cols: payload.cols,
        rows: payload.rows,
      };
    case "playbook.start":
    case "playbook.restart":
    case "playbook.stop":
      return { type: payload.type };
    default:
      return null;
  }
}

export function parseServerToBrowserMessage(raw: string): ServerToBrowserMessage | null {
  const payload = parseObject(raw);
  if (!payload || typeof payload.type !== "string") {
    return null;
  }

  switch (payload.type) {
    case "pane.meta":
      if (
        !isPaneName(payload.pane) ||
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
      if (!isPaneName(payload.pane) || typeof payload.data !== "string") {
        return null;
      }
      return { type: "pane.output", pane: payload.pane, data: payload.data };
    case "pane.status":
      if (
        !isPaneName(payload.pane) ||
        (payload.status !== "ready" && payload.status !== "closed" && payload.status !== "error")
      ) {
        return null;
      }
      return {
        type: "pane.status",
        pane: payload.pane,
        status: payload.status,
        message: optionalString(payload.message),
      };
    case "playbook.state":
      if (!isPlaybookState(payload.state)) {
        return null;
      }
      return {
        type: "playbook.state",
        state: payload.state,
        action: optionalString(payload.action),
        error: optionalString(payload.error),
      };
    case "recording.state":
      if (!isRecordingState(payload.state)) {
        return null;
      }
      return {
        type: "recording.state",
        state: payload.state,
        action: optionalString(payload.action),
        error: optionalString(payload.error),
      };
    case "preview.error":
      if (typeof payload.message !== "string") {
        return null;
      }
      return { type: "preview.error", message: payload.message };
    case "preview.reset":
      return { type: "preview.reset" };
    default:
      return null;
  }
}

function parseObject(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {}

  return null;
}

function isPaneName(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function isPlaybookState(value: unknown) {
  return (
    value === "idle" ||
    value === "running" ||
    value === "stopped" ||
    value === "done" ||
    value === "error"
  );
}

function isRecordingState(value: unknown) {
  return value === "ready" || value === "started" || value === "done" || value === "error";
}
