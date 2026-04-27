import { cp } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Pane, Stage, TmpDir, createTerminalDemo } from "@akuederle/termdem";

const exampleDir = dirname(fileURLToPath(import.meta.url));

const workspace = new TmpDir({
  setup: async (dir) => {
    await cp(join(exampleDir, "scripts"), join(dir, "scripts"), { recursive: true });
  },
});

export const { script, terminals } = createTerminalDemo(
  [
    {
      cleanup: async ({ cwd }) => {
        await execNode(join(cwd, "scripts/server.mjs"), ["cleanup"]);
      },
      name: "server",
      pwd: workspace,
    },
    {
      name: "listener",
      pwd: workspace,
    },
    {
      name: "sender",
      pwd: workspace,
    },
  ],
  async ({ pane }) => {
    const server = pane("server");
    const listener = pane("listener");
    const sender = pane("sender");

    const setup = await server.exec("node scripts/server.mjs setup", { typeDelayMs: 22 });
    const url = parseChatUrl(setup.text);

    await listener.type(`node scripts/client.mjs listen ${quoteShellArg(url)}`, { delayMs: 18 });
    await listener.press("Enter");

    await sender.exec(
      `node scripts/client.mjs send ${quoteShellArg(url)} ${quoteShellArg("hello")}`,
      {
        typeDelayMs: 18,
      },
    );
    await sender.exec(
      `node scripts/client.mjs send ${quoteShellArg(url)} ${quoteShellArg("message from sender pane")}`,
      { typeDelayMs: 18 },
    );
    await server.exec("node scripts/server.mjs status", { typeDelayMs: 18 });
  },
);

export function render() {
  return (
    <Stage>
      <main className="grid h-dvh min-h-0 grid-cols-1 grid-rows-3 gap-px bg-[#333] p-px lg:grid-cols-[1fr_1.1fr] lg:grid-rows-2">
        <Pane terminal={terminals.server} className="min-h-0 min-w-0" />
        <Pane terminal={terminals.sender} className="min-h-0 min-w-0 lg:row-start-2" />
        <Pane
          terminal={terminals.listener}
          className="min-h-0 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1"
        />
      </main>
    </Stage>
  );
}

function parseChatUrl(output: string) {
  const match = output.match(/\bCHAT_URL=(tcp:\/\/127\.0\.0\.1:\d+)\b/u);
  if (!match) {
    throw new Error(`Could not find CHAT_URL in server setup output:\n${output}`);
  }

  return match[1];
}

function quoteShellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

async function execNode(scriptPath: string, args: string[]) {
  const { execFile } = await import("node:child_process");
  await new Promise<void>((resolve) => {
    execFile(process.execPath, [scriptPath, ...args], () => resolve());
  });
}
