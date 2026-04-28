import {
  Pane,
  Stage,
  TmpDir,
  createTerminalDemo,
  keys,
  type TerminalHandles,
} from "@akuederle/termdem";

const VIM = "vim -Nu NONE -n -i NONE";

const repo = new TmpDir({
  setup: async () => {
    // The repository is intentionally empty. File authoring happens visibly via Vim.
  },
});

const demo = createTerminalDemo(
  [
    {
      name: "git",
      pwd: repo,
    },
  ],
  async (api) => {
    const git = api.pane("git");

    await git.exec("git init", { typeDelayMs: 22 });
    await git.exec("git config user.name 'termdem' && git config user.email 'demo@example.test'", {
      typeDelayMs: 12,
    });

    await git.type(`${VIM} README.md`, { delayMs: 24 });
    await git.press(keys.ENTER);
    await api.wait(600);
    await git.type("i# termdem git demo\n\nCreated from raw Vim keystrokes.\n", { delayMs: 18 });
    await git.type(keys.ESC);
    await api.wait(100);
    await git.type(":wq", { delayMs: 28 });
    await git.press(keys.ENTER);
    await api.wait(600);

    await git.type(`${VIM} README.md`, { delayMs: 24 });
    await git.press(keys.ENTER);
    await api.wait(600);
    await git.type("Go\nEdited in a second Vim session.\n", { delayMs: 18 });
    await git.type(keys.ESC);
    await api.wait(100);
    await git.type(":wq", { delayMs: 28 });
    await git.press(keys.ENTER);
    await api.wait(600);

    await git.exec("git add README.md", { typeDelayMs: 20 });
    await git.exec("git commit -m 'Create README through vim'", { typeDelayMs: 20 });
    await git.exec("git log --oneline --decorate --stat -1", { typeDelayMs: 16 });
  },
  {
    size: { width: 1280, height: 720 },
  },
);

export default demo;

export function render(terminals: TerminalHandles<typeof demo>) {
  return (
    <Stage>
      <main className="grid h-dvh bg-[#111] p-1">
        <Pane terminal={terminals.git} className="min-h-0 min-w-0" />
      </main>
    </Stage>
  );
}
