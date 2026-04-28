import {
  Dir,
  createTerminalDemo,
  quoteShellArg,
  typingDelays,
  type TerminalPaneComponents,
} from "@akuederle/termdem";

const workspacePath = decodeURIComponent(new URL(".", import.meta.url).pathname);
const workspace = new Dir({ path: workspacePath });

export const demo = createTerminalDemo({
  panes: [
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
  script: async (api) => {
    const server = api.pane("server");
    const listener = api.pane("listener");
    const sender = api.pane("sender");

    await api.wait(500);
    const setup = await server.exec("node scripts/server.mjs setup");
    const url = parseChatUrl(setup.text);

    await listener.sendLine(`node scripts/client.mjs listen ${quoteShellArg(url)}`);
    await api.waitFor("listener ready", async () => {
      const result = await api.node.exec("node", ["scripts/server.mjs", "health", url], {
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
    await api.node.exec("node", ["scripts/server.mjs", "cleanup"], {
      cwd: workspacePath,
      reject: false,
      timeoutMs: 1_000,
    });
    await api.wait(800);
  },
  settings: {
    size: { width: 1280, height: 720 },
    typeDelayMs: typingDelays.WPM_MAX,
    zoom: 1.5,
  },
});

export function render(panes: TerminalPaneComponents<typeof demo>) {
  const currentPaneClassName =
    "transition data-[termdem-current]:z-10 data-[termdem-current]:ring-2 data-[termdem-current]:ring-cyan-300 data-[termdem-current]:brightness-110";

  return (
    <main className="grid h-full w-full min-h-0 grid-cols-[1fr_1.1fr] grid-rows-2 bg-[#333]">
      <panes.server className={`min-h-0 min-w-0 ${currentPaneClassName}`} />
      <panes.sender className={`row-start-2 min-h-0 min-w-0 ${currentPaneClassName}`} />
      <panes.listener
        className={`col-start-2 row-span-2 row-start-1 min-h-0 min-w-0 ${currentPaneClassName}`}
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
