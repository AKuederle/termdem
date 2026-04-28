import { expect, test } from "vite-plus/test";
import {
  initialPreviewClientState,
  nextPreviewClientState,
  paneFrameDataAttributes,
  previewControlViewState,
  previewPaneHeaderStyle,
  previewFrameSize,
  previewZoomStyle,
  readWtermScreen,
} from "../src/preview-client.tsx";
import { queueOrSendPreviewMessage } from "../src/preview-socket.ts";

test("pane frame data attributes expose pane identity and presence-style current state", () => {
  expect(paneFrameDataAttributes("server", true)).toEqual({
    "data-termdem-current": "",
    "data-termdem-pane": "server",
  });

  expect(paneFrameDataAttributes("listener", false)).toEqual({
    "data-termdem-current": undefined,
    "data-termdem-pane": "listener",
  });
});

test("preview frame size uses the configured demo size", () => {
  expect(previewFrameSize({ size: { height: 720, width: 1280 } })).toEqual({
    height: 720,
    width: 1280,
  });
  expect(previewFrameSize({})).toBeNull();
});

test("preview zoom style scales the terminal font size", () => {
  expect(previewZoomStyle({ size: { height: 720, width: 1280 }, zoom: 1.5 })).toEqual({
    "--term-font-size": "21px",
    "--term-row-height": "26px",
    padding: 0,
  });
  expect(previewZoomStyle({})).toEqual({
    "--term-font-size": "14px",
    "--term-row-height": "17px",
    padding: 0,
  });
});

test("preview pane header style scales with terminal zoom", () => {
  expect(previewPaneHeaderStyle({ zoom: 1.5 })).toEqual({
    fontSize: "16.5px",
    height: "36px",
  });
  expect(previewPaneHeaderStyle({})).toEqual({
    fontSize: "11px",
    height: "24px",
  });
});

test("readWtermScreen extracts current terminal grid text from a wterm bridge", () => {
  const cells = [
    ["r", "e", "a", "d", "y"],
    ["o", "k", "", "", ""],
  ];

  expect(
    readWtermScreen({
      bridge: {
        getCell(row: number, col: number) {
          return { bg: 256, char: cells[row]?.[col]?.codePointAt(0) ?? 0, fg: 256, flags: 0 };
        },
        getCols: () => 5,
        getCursor: () => ({ col: 2, row: 1, visible: true }),
        getRows: () => 2,
        getScrollbackCount: () => 4,
        usingAltScreen: () => false,
      },
    }),
  ).toEqual({
    altScreen: false,
    cols: 5,
    cursor: { col: 2, row: 1, visible: true },
    lines: ["ready", "ok"],
    rows: 2,
    scrollbackCount: 4,
    text: "ready\nok",
  });
});

test("readWtermScreen returns empty snapshots before the terminal bridge is ready", () => {
  expect(readWtermScreen(null)).toEqual({
    altScreen: false,
    cols: 0,
    cursor: { col: 0, row: 0, visible: false },
    lines: [],
    rows: 0,
    scrollbackCount: 0,
    text: "",
  });
});

test("preview client state tracks playbook state and reset generation", () => {
  const running = nextPreviewClientState(initialPreviewClientState, {
    action: 'pane("main").type',
    state: "running",
    type: "playbook.state",
  });
  expect(running.playbookState).toBe("running");
  expect(running.activeAction).toBe('pane("main").type');
  expect(running.resetGeneration).toBe(0);

  const reset = nextPreviewClientState(running, { type: "preview.reset" });
  expect(reset.playbookState).toBe("idle");
  expect(reset.activeAction).toBeUndefined();
  expect(reset.resetGeneration).toBe(1);
});

test("preview controls derive disabled and pending states", () => {
  expect(
    previewControlViewState({
      pendingCommand: undefined,
      playbookState: "running",
      socketStatus: "open",
    }),
  ).toMatchObject({
    restartDisabled: false,
    stopDisabled: false,
  });

  expect(
    previewControlViewState({
      pendingCommand: "restart",
      playbookState: "running",
      socketStatus: "open",
    }),
  ).toMatchObject({
    pendingCommand: "restart",
    restartDisabled: true,
    stopDisabled: true,
  });

  expect(
    previewControlViewState({
      pendingCommand: undefined,
      playbookState: "stopped",
      socketStatus: "closed",
    }),
  ).toMatchObject({
    restartDisabled: true,
    stopDisabled: true,
  });
});

test("preview socket messages queue before the websocket is open", () => {
  const pending: Parameters<typeof queueOrSendPreviewMessage>[1] = [];
  const sent: string[] = [];
  const socket = {
    readyState: 0 as WebSocket["readyState"],
    send(message: string) {
      sent.push(message);
    },
  };

  queueOrSendPreviewMessage(socket, pending, {
    cols: 149,
    pane: "git",
    rows: 40,
    type: "pane.resize",
  });

  expect(sent).toEqual([]);
  expect(pending).toEqual([{ cols: 149, pane: "git", rows: 40, type: "pane.resize" }]);
});

test("preview socket messages send immediately once the websocket is open", () => {
  const pending: Parameters<typeof queueOrSendPreviewMessage>[1] = [];
  const sent: string[] = [];

  queueOrSendPreviewMessage(
    {
      readyState: 1,
      send(message: string) {
        sent.push(message);
      },
    },
    pending,
    {
      cols: 149,
      pane: "git",
      rows: 40,
      type: "pane.resize",
    },
  );

  expect(pending).toEqual([]);
  expect(sent).toEqual(['{"cols":149,"pane":"git","rows":40,"type":"pane.resize"}']);
});
