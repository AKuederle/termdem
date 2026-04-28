import { expect, test } from "vite-plus/test";
import { paneFrameDataAttributes } from "../src/preview-client.tsx";

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
