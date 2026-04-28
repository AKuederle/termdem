import {
  TmpDir,
  createTerminalDemo,
  keys,
  typingDelays,
  type TerminalPaneComponents,
} from "@akuederle/termdem";

const repo = new TmpDir({
  setup: async () => {
    // The repository is intentionally empty. File authoring happens visibly via Vim.
  },
});

export const demo = createTerminalDemo({
  panes: [
    {
      name: "git",
      pwd: repo,
    },
  ],
  script: async (api) => {
    const git = api.pane("git");

    await git.exec("git init");
    await git.exec("git config user.name 'termdem' && git config user.email 'demo@example.test'");

    await git.sendLine("vim README.md");
    await api.wait(600);
    await git.type("i# termdem git demo\n\nCreated from raw Vim keystrokes.\n");
    await git.type(keys.ESC);
    await api.wait(100);
    await git.type(":wq");
    await git.press(keys.ENTER);
    await api.wait(600);

    await git.sendLine("vim README.md");
    await api.wait(600);
    await git.type("Go\nEdited in a second Vim session.\n");
    await git.type(keys.ESC);
    await api.wait(100);
    await git.type(":wq");
    await git.press(keys.ENTER);
    await api.wait(600);

    await git.exec("git add README.md");
    await git.exec("git commit -m 'Create README through vim'");
    await git.exec("git log --oneline --decorate --stat -1");
  },
  setup: async (api) => {
    // Keep the recording focused on `vim README.md`, while making Vim deterministic:
    // ignore user config/history, skip swap files, and make Esc resolve quickly.
    await api
      .pane("git")
      .exec(`alias vim='vim -Nu NONE -n -i NONE --cmd "set ttimeout ttimeoutlen=10"'`);
  },
  settings: {
    size: { width: 1280, height: 720 },
    typeDelayMs: typingDelays.WPM_120,
  },
});

export function render(panes: TerminalPaneComponents<typeof demo>) {
  return (
    <main className="grid h-full w-full bg-[#111] p-1">
      <panes.git className="min-h-0 min-w-0 transition data-[termdem-current]:ring-2 data-[termdem-current]:ring-cyan-300 data-[termdem-current]:brightness-110" />
    </main>
  );
}
