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

We assume, the terminal app you want to demo is written in JS/TS and you already have a JS project for this library (we will cover standalone usage later).

1. Add `@akuederle/termdem` to your dev dependencies.
2. Create a folder where you want to place your demos. Each demo will be a single file, but it can import from other files using normal JS imports.
3. Create your first demo as `.tsx` file.

A demo file needs to export a `demo` object that is returned by `createTerminalDemo` and a render function that takes a set of terminal components as props and returns a react scene.
You have built-in access for [tailwind@v4]() to style the scene.

A minimal scene with two panes looks like this.

```ts
import {
  TmpDir,
  createTerminalDemo,
  type TerminalPaneComponents,
} from "@akuederle/termdem";

const workspace = new TmpDir({});

export const demo = createTerminalDemo({
  panes: [
    {
      name: "pane1",
      pwd: workspace,
    },
    {
      name: "pane2",
      pwd: workspace,
    },
  ],
  script: async () => {},
  settings: {
    size: { width: 1920, height: 1080 },
  },
});

export function render(panes: TerminalPaneComponents<typeof demo>) {
  return (
    <main className="grid h-full w-full min-h-0 grid-cols-2 grid-rows-1 gap-px bg-[#333] p-px">
      <panes.pane1 className="min-h-0 min-w-0" />
      <panes.pane2 className="min-h-0 min-w-0" />
    </main>
  );
}
```

## Tips

### Highlight the active terminal

### Run Setup and Teardown

There are multiple levels of setup and teardown levels.
The first one is for the working dir.
Both `Dir` and `TmpDir` support `setup` and `teardown` funcs that allow to seed the dirs with certain files.
Note, that for `TmpDir`, `teardown` is usually not required, as we just delete the dir after the run.

The second level are the `setup` and `teardown` funcs that can be passed to `createTerminalDemo`.
They work like the script callback and have access to the same functionality, with two distinctions.
The commands are not displayed on the frontend and the default `typingDelay` is set to 0 ms/typing simulation for `exec` is turned off to speed up the execution.
The setup func can return a data object that will be provided as a second argument to the `script`

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
