import { expect, test } from "vite-plus/test";
import { paneFrameDataAttributes, previewFrameSize } from "../src/preview-client.tsx";
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
