# Termdem

Create complex terminal demos videos using JS/TS

## Features

- Multiple terminal panes with custom styling
- Simulated typing
- Hidden setup/background commands
- Access to outputs of each terminal command for complex orchestration

## Install

Mac and Linux only at the moment!

```
npm install @akuederle/termdem
```

<!-- TODO: Add palywright setup + ffmped -->

## Usage

Termdem works best when the terminal app you want to demo already lives in a JavaScript or TypeScript project.
Create one `.tsx` file per demo, export the `demo` returned by `createTerminalDemo`, and export a `render` function that lays out the terminal panes.

1. Add `@akuederle/termdem` to your dev dependencies.
2. Create a folder for your demos.
3. Add a `.tsx` demo file.
4. Configure panes, write the script, and render the scene.

### Create a Scene

Panes define the terminals that the script can control and the render function can display.
The render function receives one React component per pane, keyed by pane name.
Tailwind v4 is available in demo files, so regular utility classes are enough for most layouts.

```tsx
import { TmpDir, createTerminalDemo, type TerminalPaneComponents } from "@akuederle/termdem";

const workspace = new TmpDir({});

export const demo = createTerminalDemo({
  panes: [
    { name: "server", pwd: workspace },
    { name: "client", pwd: workspace },
  ],
  script: async () => {},
  settings: {
    size: { width: 1920, height: 1080 },
  },
});

export function render(panes: TerminalPaneComponents<typeof demo>) {
  return (
    <main className="grid h-full w-full min-h-0 grid-cols-2 grid-rows-1 gap-px bg-[#333] p-px">
      <panes.server className="min-h-0 min-w-0" />
      <panes.client className="min-h-0 min-w-0" />
    </main>
  );
}
```

### Create a Script

The script is an async function that receives an `api` object.
Use `api.pane(name)` to select a pane and then drive it with `exec`, `sendLine`, `type`, and `press`.
Use normal JavaScript between terminal actions whenever you need to parse output or decide the next command.

```ts
import { quoteShellArg } from "@akuederle/termdem";

export const demo = createTerminalDemo({
  panes: [
    { name: "server", pwd: workspace },
    { name: "client", pwd: workspace },
  ],
  script: async (api) => {
    const server = api.pane("server");
    const client = api.pane("client");

    const setup = await server.exec("node scripts/server.mjs setup");
    const url = setup.lines.find((line) => line.startsWith("URL="))?.slice("URL=".length);

    if (!url) {
      throw new Error("Server did not print a URL");
    }

    await server.sendLine(`node scripts/server.mjs listen ${quoteShellArg(url)}`);
    await api.waitFor("server ready", async () => {
      const result = await api.node.exec("curl", ["-fsS", url], {
        reject: false,
        timeoutMs: 1000,
      });

      return result.exitCode === 0;
    });

    await client.exec(`node scripts/client.mjs ${quoteShellArg(url)}`);
  },
});
```

The pane API is for visible terminal work.
Use `exec` for commands that should finish, `sendLine` for long-running processes, `type` for raw text input, and `press` for single keys or key combinations such as `keys.CTRL_C` and `keys.ESC`.

The top-level API is for orchestration.
Use `wait` for fixed delays, `waitFor` for readiness checks, and `node.exec` for hidden Node-side subprocesses that should not appear in the terminal.

See the full [socket CLI example](./examples/socket-cli/demo.tsx) for a multi-pane server/client demo.
See the full [Git/Vim example](./examples/git-vim/demo.tsx) for an interactive full-screen terminal app demo.

## Tips

### Highlight the active terminal

Every pane component receives a `data-termdem-current` attribute while it is the pane currently controlled by the script.
Use Tailwind's data selector variants to make that pane stand out without adding state to your render function.

```tsx
<panes.server className="transition data-[termdem-current]:ring-2 data-[termdem-current]:ring-cyan-300 data-[termdem-current]:brightness-110" />
<panes.client className="transition data-[termdem-current]:ring-2 data-[termdem-current]:ring-cyan-300 data-[termdem-current]:brightness-110" />
```

### Configure working dirs

Use `Dir` when the demo should run inside an existing directory, and `TmpDir` when the demo should get a fresh disposable workspace.
Multiple panes can share the same workspace object; for most demos, prefer `TmpDir` and seed it in `setup` so every recording starts from a clean state.

```ts
const workspace = new TmpDir({
  setup: async (path) => {
    await fs.writeFile(`${path}/README.md`, "# Demo\n");
  },
});

panes: [
  { name: "server", pwd: workspace },
  { name: "client", pwd: workspace },
];
```

### Run Setup and Teardown

Directory `setup` and `teardown` prepare files before panes start, while demo-level `setup` and `teardown` use the same API as `script` for hidden terminal and Node-side work.
Demo-level commands are not displayed, run with instant typing by default, and `setup` can return data that is passed as the second `script` argument.

```ts
export const demo = createTerminalDemo({
  setup: async (api) => {
    const result = await api.pane("main").exec("node scripts/prepare.mjs");
    return { token: result.text };
  },
  script: async (api, setupData) => {
    await api.pane("main").exec(`node cli.mjs login ${quoteShellArg(setupData.token)}`);
  },
  teardown: async (api) => {
    await api.node.exec("node", ["scripts/cleanup.mjs"], { reject: false });
  },
});
```

### Full-screen Terminal Apps

For editors and other full-screen terminal apps, start the process with `sendLine()` so the script can keep sending keystrokes while the app remains open.
Use `type()` for raw input, `press(keys.ENTER)` for supported special keys, and short `wait()` calls when the app needs a moment to redraw.

```ts
await pane.sendLine("vim README.md");
await api.wait(300);
await pane.type("i# Demo notes\n");
await pane.type(keys.ESC);
await pane.type(":wq");
await pane.press(keys.ENTER);
```

### Typing speed

Typing speed is controlled by `typeDelayMs`, either globally in `settings` or per command/input call.
Setup and teardown default to instant input, but visible interactive apps sometimes need a small delay because terminals can drop or reorder keypresses that arrive too quickly.

```ts
settings: {
  typeDelayMs: typingDelays.WPM_120,
},

await pane.exec("npm test", { typeDelayMs: 0 });
await pane.type("iTyped into Vim\n", { typeDelayMs: typingDelays.WPM_60 });
```

### Parsing command outputs

`pane.exec()` waits for the command to finish and returns cleaned output.
Use `text` for the full stripped output, or `lines` when you need to pick a value for a later command.

```ts
const result = await api.pane("server").exec("node scripts/server.mjs setup");
const url = result.lines.find((line) => line.startsWith("CHAT_URL="))?.slice("CHAT_URL=".length);

await api.pane("client").exec(`node client.mjs ${quoteShellArg(url)}`);
```

### "Hidden" Commands

Use normal JavaScript inside `script`, `setup`, and `teardown` for values that do not need a shell, and use `api.node.exec()` for hidden subprocesses.
`api.node.exec()` can run any executable available to the preview server, but it receives an executable plus an argument array rather than a shell command string.
Use `sh -c` explicitly if you need shell syntax such as pipes, redirects, or environment-variable expansion.
Use `pane.cwd()` when the hidden process should run in the same current working directory as a pane.
This pairs well with `api.waitFor()` when a visible pane starts a server and the script needs to wait until it is ready.

```ts
const server = api.pane("server");
await server.sendLine("npm run dev");

await api.waitFor("server ready", async () => {
  const cwd = await server.cwd();
  const result = await api.node.exec("curl", ["-fsS", "http://127.0.0.1:5173"], {
    cwd,
    reject: false,
    timeoutMs: 1000,
  });

  return result.exitCode === 0;
});
```

## How it works

A demo file defines a script (the steps to be performed) and the visual layout as react components.
We use vite to split this file into a server (the execution engine) and a client bundle (rendering).

The frontend uses [wterm]() to render a posix compliant terminal in the browser.
Each rendered terminal connects to backend PTY via websocket.

The execution engine then runs commands in the PTY and echos the terminal codes and text to the terminal rendered in the browser.

For recording, we use a headless Chromium instance orchestrated via [playwright]() and use the browser built-in record functionality to generate the video.
Finally, we use _ffmpeg_ to convert the video to its final format.

## Why this exists

I needed to record a terminal based demo that showed two process communicating with each other using a websocket.
To make this a reliable demo, I could easily re-record once I update the code, I thought it might be nice to script it.

Based on this I found [vhs](), which has a very nice API to script and record terminal sessions.
To make it possible to show multiple processes (aka multiple terminals), I used tmux to multiplex the terminal session that was recorded.

This worked great, but _vhs_ is missing one critical feature: Parsing the typed outputs from within the script.

The demo I was preparing demonstrated a secret based connection establishment and secret from one process needs to be sent to the second process via a "side channel" (aka copy and past, if I would record the demo manually).
Unfortunately, in vhs it is impossible to get the output of previous commands to interactively change the subsequent commands.

So simply speaking, I wanted a way to record terminal demos optimized for multiple panes and with the ability to intersect and parse the output of each command.
