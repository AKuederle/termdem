# Termdem

Create complex terminal demo videos using JS/TS.

## Features

- Script multiple terminal panes in one recording.
- Style each pane with regular React and Tailwind.
- Simulate realistic typing, special keys, and interactive terminal apps.
- Run hidden setup, teardown, and background checks.
- Capture command output and use it to drive later steps.

## Install

> [!WARNING]
> Termdem is currently supported on macOS and Linux only.

```
npm install @akuederle/termdem
```

Install the Playwright browser binaries before recording demos.

```
npx playwright install chromium
```

WebM recording works out of the box after the Chromium install.
Install [ffmpeg](https://ffmpeg.org/) if you want to record to non-WebM formats such as MP4.

## Usage

Termdem works best when the terminal app you want to demo already lives in a JavaScript or TypeScript project.
Create one `.tsx` file per demo, export the `demo` returned by `createTerminalDemo`, and export a `render` function that lays out the terminal panes.

1. Add `@akuederle/termdem` to your dev dependencies.
2. Create a folder for your demos.
3. Add a `.tsx` demo file.
4. Configure panes, write the script, and render the scene.
5. Preview the demo in your browser with `npx termdem preview ./demos/demo.tsx`.
6. Record the demo to a video file with `npx termdem record ./demos/demo.tsx ./demo.webm`.

> [!WARNING]
> Demo files are loaded in two places: the preview server runs `setup`, `script`, and `teardown`, while the browser imports the same module to render the panes.
> Importing backend-only modules such as `node:fs`, `node:path`, or `node:dgram` is fine when they are only used from server-side callbacks.
> Do not execute backend-only code at module top level, because the browser render path evaluates top-level code too.
> Keep filesystem, socket, process, and other Node-only work inside `TmpDir` setup, demo `setup`, `script`, `teardown`, or functions called only from those callbacks.

### Create a Scene

Panes define the terminals that the script can control and the render function can display.
The render function receives one React component per pane, keyed by pane name.
[Tailwind v4](https://tailwindcss.com/) is available in demo files, so regular utility classes are enough for most layouts.

```tsx
import { TmpDir, createTerminalDemo, type TerminalPaneComponents } from "@akuederle/termdem";

const workspace = new TmpDir();

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
import { TmpDir, createTerminalDemo, quoteShellArg, typedString } from "@akuederle/termdem";

const workspace = new TmpDir();

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

    await server.sendLine([
      "node scripts/server.mjs listen ",
      typedString(quoteShellArg(url), { typeDelayMs: 0 }),
    ]);
    await api.waitFor("server ready", async () => {
      const result = await api.sidecar.exec("curl", ["-fsS", url], {
        reject: false,
        timeoutMs: 1000,
      });

      return result.exitCode === 0;
    });

    await client.exec([
      "node scripts/client.mjs ",
      typedString(quoteShellArg(url), { typeDelayMs: 0 }),
    ]);
  },
});
```

The pane API is for visible terminal work.
Use `exec` for commands that should finish, `sendLine` for long-running processes, `type` for raw text input, and `press` for single keys or key combinations such as `keys.CTRL_C` and `keys.ESC`.

The top-level API is for orchestration.
Use `wait` for fixed delays, `waitFor` for readiness checks, and `sidecar.exec` for hidden sidecar subprocesses that should not appear in the terminal.

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

Directory `setup` and `teardown` prepare files before panes start, while demo-level `setup` and `teardown` use the same API as `script`.
Demo-level setup and teardown pane commands are visible by default, run with instant typing by default, and `setup` can return data that is passed as the second `script` argument.
Use `pane.hidden.*` for setup or teardown commands that should run in the pane shell without appearing in the terminal.

```ts
export const demo = createTerminalDemo({
  setup: async (api) => {
    const result = await api.pane("main").hidden.exec("node scripts/prepare.mjs");
    return { token: result.text };
  },
  script: async (api, setupData) => {
    await api.pane("main").exec(`node cli.mjs login ${quoteShellArg(setupData.token)}`);
  },
  teardown: async (api) => {
    await api.sidecar.exec("node", ["scripts/cleanup.mjs"], { reject: false });
  },
});
```

### Full-screen Terminal Apps/Long running processes.

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
Use `typedString()` when one part of an input should use a different speed, such as typing a command prefix and pasting a generated argument.
Raw string segments use the command/input `typeDelayMs`, then the demo-level `settings.typeDelayMs`, then the built-in default.
`typedString()` segments inherit that same delay unless they provide their own `typeDelayMs`.
Segments are concatenated exactly, so include spaces in the strings where the final terminal input needs spaces.

```ts
settings: {
  typeDelayMs: typingDelays.WPM_120,
},

await pane.exec("npm test", { typeDelayMs: 0 });
await pane.type("iTyped into Vim\n", { typeDelayMs: typingDelays.WPM_60 });
await pane.exec(
  ["node scripts/client.mjs ", typedString(quoteShellArg(url), { typeDelayMs: 0 })],
  { typeDelayMs: typingDelays.WPM_80 },
);
```

### Parsing command outputs

`pane.exec()` waits for the command to finish and returns cleaned output.
Use `text` for the full stripped output, or `lines` when you need to pick a value for a later command.

```ts
const result = await api.pane("server").exec("node scripts/server.mjs setup");
const url = result.lines.find((line) => line.startsWith("CHAT_URL="))?.slice("CHAT_URL=".length);

await api.pane("client").exec(`node client.mjs ${quoteShellArg(url)}`);
```

### Reading long-running terminal screens

Use `pane.screen()` after starting a long-running command with `sendLine()` when you need the terminal's current rendered buffer.
This works for output that redraws in place, such as `watch`, progress UIs, and dev servers.

```ts
const server = api.pane("server");
await server.sendLine("pnpm dev");

await api.waitFor("dev server ready", async () => {
  const screen = await server.screen();
  return screen.text.includes("Local:");
});
```

### "Hidden" Commands

Use `pane.hidden.exec()`, `pane.hidden.sendLine()`, `pane.hidden.type()`, and `pane.hidden.press()` when hidden work must run in the same pane shell and influence later visible pane state such as exports or `cd`.
Use normal JavaScript inside `script`, `setup`, and `teardown` for values that do not need a shell, and use `api.sidecar.exec()` for hidden subprocesses that do not need to modify pane state.
`api.sidecar.exec()` can run any executable available to the preview server, but it receives an executable plus an argument array rather than a shell command string.
Use `sh -c` explicitly if you need shell syntax such as pipes, redirects, or environment-variable expansion.
Use `pane.getEnv()` when the sidecar process should run with a snapshot of a pane's exported environment and current working directory.
Capture the snapshot before starting a foreground process such as a dev server or Vim, because the pane shell cannot answer hidden commands while another program owns the terminal.
This pairs well with `api.waitFor()` when a visible pane starts a server and the script needs to wait until it is ready.

```ts
const server = api.pane("server");
const environment = await server.getEnv();
await server.sendLine("npm run dev");

await api.waitFor("server ready", async () => {
  const result = await api.sidecar.exec("curl", ["-fsS", "http://127.0.0.1:5173"], {
    environment,
    reject: false,
    timeoutMs: 1000,
  });

  return result.exitCode === 0;
});
```

### Show preview controls

When running in preview mode (`termdem preview demo.tsx`), press `Ctrl + .` in the preview window to show or hide the replay controls.
This can be used to restart the run or stop it at a certain point to inspect the output.

### Scale terminal content

Use `zoom` to scale terminal font size while keeping `size` as the video output size.
For a higher-resolution video with similarly readable text, increase `size` and `zoom` by the
same factor. For example, moving from `1280x720` to `2560x1440` with `zoom: 2` keeps the terminal
content visually comparable while producing a larger video.

```ts
settings: {
  size: { width: 1280, height: 720 },
  zoom: 1.5,
}
```

## How it works

A demo file defines a script, which is the sequence of steps to run, and a visual layout made from React components.
Termdem uses [Vite](https://vite.dev/) to split that file into a server-side execution engine and a client-side rendering bundle.

The frontend uses [wterm](https://wterm.dev/react) to render a POSIX-compatible terminal in the browser.
Each rendered terminal connects to a backend PTY over WebSocket.

The execution engine runs commands in the PTY and echoes terminal codes and text to the terminal rendered in the browser.

For recording, Termdem uses a headless Chromium instance orchestrated by [Playwright](https://playwright.dev/) and the browser's built-in recording functionality to generate the video.
Finally, Termdem uses [ffmpeg](https://ffmpeg.org/) to convert the video to its final format when needed.

## Why this exists

I needed to record a terminal based demo that showed two processes communicating with each other over a WebSocket.
To make the demo reliable and easy to re-record whenever the code changed, I wanted to script it.

Based on this, I found [VHS](https://github.com/charmbracelet/vhs), which has a very nice API to script and record terminal sessions.
To make it possible to show multiple processes (aka multiple terminals), I used tmux to multiplex the terminal session that was recorded.

This worked great, but _VHS_ is missing one critical feature: parsing the typed outputs from within the script.

The demo I was preparing demonstrated a secret based connection establishment, and a secret from one process needed to be sent to the second process through a "side channel" (aka copy and paste, if I recorded the demo manually).
Unfortunately, in VHS it is impossible to get the output of previous commands and use it to interactively change subsequent commands.

So simply speaking, I wanted a way to record terminal demos optimized for multiple panes, with the ability to inspect and parse the output of each command.
