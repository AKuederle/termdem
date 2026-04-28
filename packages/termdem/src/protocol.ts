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

export type PaneScreenSnapshot = {
  altScreen: boolean;
  cols: number;
  cursor: {
    col: number;
    row: number;
    visible: boolean;
  };
  lines: string[];
  rows: number;
  scrollbackCount: number;
  text: string;
};

export type PaneScreenResponseMessage = {
  type: "pane.screen.response";
  pane: string;
  requestId: string;
  snapshot: PaneScreenSnapshot;
};

export type PlaybookControlMessage = {
  type: "playbook.start" | "playbook.restart" | "playbook.stop";
};

export type BrowserToServerMessage =
  | PaneInputMessage
  | PaneResizeMessage
  | PaneScreenResponseMessage
  | PlaybookControlMessage;

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

export type PaneScreenRequestMessage = {
  type: "pane.screen.request";
  pane: string;
  requestId: string;
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
  | PaneScreenRequestMessage
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
    case "pane.screen.response": {
      const snapshot = parsePaneScreenSnapshot(payload.snapshot);
      if (!isPaneName(payload.pane) || !isRequestId(payload.requestId) || !snapshot) {
        return null;
      }
      return {
        type: "pane.screen.response",
        pane: payload.pane,
        requestId: payload.requestId,
        snapshot,
      };
    }
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
    case "pane.screen.request":
      if (!isPaneName(payload.pane) || !isRequestId(payload.requestId)) {
        return null;
      }
      return { type: "pane.screen.request", pane: payload.pane, requestId: payload.requestId };
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

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

function isRequestId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function parsePaneScreenSnapshot(value: unknown): PaneScreenSnapshot | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }

  const snapshot = value as Record<string, unknown>;
  const cursor = snapshot.cursor;
  if (typeof cursor !== "object" || cursor === null || Array.isArray(cursor)) {
    return null;
  }

  const cursorRecord = cursor as Record<string, unknown>;
  if (
    typeof snapshot.altScreen !== "boolean" ||
    !isNonNegativeInteger(snapshot.cols) ||
    !isNonNegativeInteger(snapshot.rows) ||
    !isNonNegativeInteger(snapshot.scrollbackCount) ||
    typeof snapshot.text !== "string" ||
    !Array.isArray(snapshot.lines) ||
    !snapshot.lines.every((line) => typeof line === "string") ||
    !isNonNegativeInteger(cursorRecord.col) ||
    !isNonNegativeInteger(cursorRecord.row) ||
    typeof cursorRecord.visible !== "boolean"
  ) {
    return null;
  }

  return {
    altScreen: snapshot.altScreen,
    cols: snapshot.cols,
    cursor: {
      col: cursorRecord.col,
      row: cursorRecord.row,
      visible: cursorRecord.visible,
    },
    lines: snapshot.lines,
    rows: snapshot.rows,
    scrollbackCount: snapshot.scrollbackCount,
    text: snapshot.text,
  };
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
