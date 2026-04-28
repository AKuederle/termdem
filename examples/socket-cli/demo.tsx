import {
  Dir,
  createTerminalDemo,
  quoteShellArg,
  typingDelays,
  type TerminalPaneComponents,
} from "@akuederle/termdem";

const workspacePath = decodeURIComponent(new URL(".", import.meta.url).pathname);
const workspace = new Dir(() => workspacePath);

const demo = createTerminalDemo(
  [
    {
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
  async (api) => {
    const server = api.pane("server");
    const listener = api.pane("listener");
    const sender = api.pane("sender");

    const setup = await server.exec("node scripts/server.mjs setup");
    const url = parseChatUrl(setup.text);

    await listener.sendLine(`node scripts/client.mjs listen ${quoteShellArg(url)}`);
    await api.waitFor("listener ready", async () => {
      const result = await api.node.execFile("node", ["scripts/server.mjs", "health", url], {
        cwd: workspacePath,
        reject: false,
        timeoutMs: 1_000,
      });

      return result.exitCode === 0 && result.stdout.includes("listener ready");
    });

    await sender.exec(
      `node scripts/client.mjs send ${quoteShellArg(url)} ${quoteShellArg("hello")}`,
    );
    await sender.exec(
      `node scripts/client.mjs send ${quoteShellArg(url)} ${quoteShellArg("message from sender pane")}`,
    );
    await server.exec("node scripts/server.mjs status");
    await api.node.execFile("node", ["scripts/server.mjs", "cleanup"], {
      cwd: workspacePath,
      reject: false,
      timeoutMs: 1_000,
    });
  },
  {
    size: { width: 1920, height: 1080 },
    typeDelayMs: typingDelays.WPM_120,
    viewportSize: { width: 1440, height: 810 },
  },
);

export default demo;

export function render(panes: TerminalPaneComponents<typeof demo>) {
  const ServerPane = panes.server;
  const SenderPane = panes.sender;
  const ListenerPane = panes.listener;
  const currentPaneClassName =
    "transition data-[termdem-current]:relative data-[termdem-current]:z-10 data-[termdem-current]:ring-2 data-[termdem-current]:ring-cyan-300 data-[termdem-current]:brightness-110";

  return (
    <main className="grid h-dvh min-h-0 grid-cols-1 grid-rows-3 gap-px bg-[#333] p-px lg:grid-cols-[1fr_1.1fr] lg:grid-rows-2">
      <ServerPane className={`min-h-0 min-w-0 ${currentPaneClassName}`} />
      <SenderPane className={`min-h-0 min-w-0 lg:row-start-2 ${currentPaneClassName}`} />
      <ListenerPane
        className={`min-h-0 min-w-0 lg:col-start-2 lg:row-span-2 lg:row-start-1 ${currentPaneClassName}`}
      />
    </main>
  );
}

function parseChatUrl(output: string) {
  const match = output.match(/\bCHAT_URL=(tcp:\/\/127\.0\.0\.1:\d+)\b/u);
  if (!match) {
    throw new Error(`Could not find CHAT_URL in server setup output:\n${output}`);
  }

  return match[1];
}
