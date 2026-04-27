import { expect, test } from "vite-plus/test";
import { createTerminalDemo, TmpDir } from "../src/index.ts";

test("createTerminalDemo preserves backend terminal definitions and config", () => {
  const dir = new TmpDir();
  const script = () => {};

  const demo = createTerminalDemo(
    [
      {
        name: "server",
        pwd: dir,
      },
      {
        name: "client",
        pwd: dir,
      },
    ],
    script,
    {
      size: { width: 1920, height: 1080 },
      viewportSize: { width: 1440, height: 900 },
    },
  );

  expect(demo.terminalDefinitions.map((terminal) => terminal.name)).toEqual(["server", "client"]);
  expect(demo.script).toBe(script);
  expect(demo.config).toEqual({
    size: { width: 1920, height: 1080 },
    viewportSize: { width: 1440, height: 900 },
  });
});
