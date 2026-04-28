import { expect, test } from "vite-plus/test";
import {
  paneFrameDataAttributes,
  previewPaneHeaderStyle,
  previewFrameSize,
  previewZoomStyle,
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
