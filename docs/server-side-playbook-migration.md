# Server-Side Playbook Migration Plan

## Goal

Move demo script execution out of the browser and into the Node preview server.

The browser should keep rendering terminal panes with `@wterm/react`, but it should no longer own the playbook control flow. The Node process should own PTYs, playbook execution, hidden health checks, recording state, and process cleanup.

Backwards compatibility is not required. We can replace the current browser-run playbook API instead of layering compatibility shims on top.

## Current Problem

Today the preview client imports the demo module in the browser and runs `demo.script(api)` there. Pane actions are then sent over WebSocket to the Node preview server, which forwards them into PTYs.

That creates two classes of problems:

- Browser code cannot safely run Node-only work such as `execFile`, health checks, filesystem probes, or background setup.
- Trying to tunnel hidden work through a terminal pane couples health checks to PTY prompt detection, shell job control, visible terminal state, and pane command queues.

The socket example exposed this directly: a hidden readiness check should be a plain Node child process call, but routing it through a pane makes it race with visible terminal activity.

## Target Architecture

### Node Preview Server

The preview server becomes the playbook runtime:

- Loads the demo module with Vite SSR.
- Creates terminal workspaces and PTY sessions.
- Runs `demo.script(api)` in Node.
- Owns playbook lifecycle: idle, running, stopped, done, error.
- Owns recording state: ready, started, current action, done, error.
- Runs hidden Node tasks with `child_process.execFile`.
- Broadcasts terminal output and playbook state to connected browser clients.
- Receives resize and optional interactive user input from browser clients.

### Browser Preview Client

The browser becomes the renderer and controller UI:

- Renders panes with `@wterm/react`.
- Displays PTY output received from the server.
- Sends pane resize events to the server.
- Sends user input in interactive preview mode.
- Displays current pane/action state.
- Starts, pauses, resumes, or restarts the server-side playbook through preview control messages.

`@wterm/react` remains required because it provides the real terminal rendering behavior: ANSI sequences, cursor movement, alternate screen behavior, wrapping, resizing, and native terminal feel.

### Transport

Use one WebSocket control protocol between browser and preview server.

Server to browser:

- `pane.output`
- `pane.meta`
- `pane.status`
- `playbook.state`
- `recording.state`
- `preview.error`

Browser to server:

- `pane.resize`
- `pane.input` for interactive preview
- `playbook.start`
- `playbook.pause`
- `playbook.resume`
- `playbook.restart`
- `playbook.stop`

The playbook itself should not be transported as browser-executed JavaScript.

## New Playbook API

Replace the current browser-shaped API with a Node-native API.

```ts
type TerminalDemoScriptApi<Name extends string> = {
  pane(name: Name): PaneController;
  node: NodeController;
  wait(delayMs: number): Promise<void>;
  waitFor(label: string, probe: () => Promise<boolean>, options?: WaitForOptions): Promise<void>;
};

type NodeController = {
  execFile(
    file: string,
    args?: readonly string[],
    options?: NodeExecOptions,
  ): Promise<NodeExecResult>;
};
```

Pane controller:

```ts
type PaneController = {
  type(text: string, options?: TypeOptions): Promise<void>;
  press(key: PressKey): Promise<void>;
  exec(command: string, options?: ExecOptions): Promise<ExecResult>;
  sendLine(command: string, options?: TypeOptions): Promise<void>;
};
```

Important semantics:

- `exec` means run a shell command and wait for the prompt to return.
- `sendLine` means visibly type or send a command and do not wait for completion.
- `node.execFile` means run hidden Node-side work without touching any terminal pane.
- `waitFor` is the standard way to express readiness checkpoints.

## Example Shape

The socket example should become:

```ts
const setup = await server.exec("node scripts/server.mjs setup");
const url = parseChatUrl(setup.text);

await listener.sendLine(`node scripts/client.mjs listen ${quoteShellArg(url)}`);

await api.waitFor("listener ready", async () => {
  const result = await api.node.execFile("node", ["scripts/server.mjs", "health", url], {
    cwd: workspacePath,
    reject: false,
    timeoutMs: 1000,
  });

  return result.exitCode === 0;
});

await sender.exec(`node scripts/client.mjs send ${quoteShellArg(url)} ${quoteShellArg("hello")}`);
```

This keeps the listener visible while making readiness a hidden Node probe.

## Migration Phases

### Phase 1: Protocol Boundary

- Define a preview protocol around playbook state, recording state, pane output, resize, and user input.
- Split protocol types by direction: browser-to-server and server-to-browser.
- Add tests for protocol parsing and invalid message rejection.
- Remove browser-only assumptions from protocol names.

### Phase 2: Server-Side Pane Manager

- Introduce a `PreviewRuntime` or `PlaybookRuntime` class in Node.
- Move pane session creation and workspace lifecycle behind that runtime.
- Keep `PaneSession` as the PTY abstraction.
- Add `sendLine` to `PaneSession`.
- Keep `exec` prompt-based and explicit.
- Make cleanup centralized and idempotent.

### Phase 3: Server-Side Playbook Runner

- Load the demo module once in the preview server.
- Run `demo.script(api)` in Node.
- Implement `wait`, `waitFor`, `pane`, and `node.execFile`.
- Add cancellation or generation IDs so restart/stop cannot update stale state.
- Broadcast playbook state changes to browsers.

### Phase 4: Browser Renderer Simplification

- Remove browser execution of `demo.script(api)`.
- Keep browser import of `render` only if needed for React pane layout.
- Provide pane components that render server-connected `wterm` instances.
- Replace browser-side `createPlaybookApi` with control UI calls.
- Remove browser shim exports for Node helpers such as `execNode`.

### Phase 5: Recording Integration

- Recording should call server playbook start through the same control protocol as preview.
- `recordBrowserPage` waits for server-published recording/playbook state.
- `ready` means all rendered panes are mounted, connected, sized, and server runtime is ready.
- `done` means the server-side playbook has completed and all pending pane output has flushed.

### Phase 6: Examples

- Update `git-vim` to use `sendLine` for interactive Vim launches.
- Update `socket-cli` to use `sendLine` for the listener and `api.waitFor` with `api.node.execFile` for health.
- Remove workaround background shell commands and hidden pane exec usage.
- Ensure every example has deterministic cleanup.

### Phase 7: Smoke Tests and CI

- Keep smoke tests in a separate Vitest group.
- Build the package before smoke tests.
- Record each example to a temp video file.
- Assert:
  - output file exists,
  - output file size is non-trivial,
  - `ffprobe` reports duration within a tolerance.
- Run smoke tests in GitHub Actions after check, unit tests, and build.
- Use the Playwright Docker image that matches the locked Playwright version so browsers are preinstalled.
- Install `ffmpeg` in CI if the image does not provide the needed system binary.

### Phase 8: Random Ports

- Let Vite listen on port `0` when no explicit port is provided.
- Preserve explicit `port` overrides with strict behavior.
- Use `viteServer.resolvedUrls` as the source of truth.
- Avoid preselecting and then releasing a free port, because that has a race under parallel runs.

## Deletions To Prefer

Because there are no users yet, prefer deleting transitional abstractions instead of keeping compatibility:

- Remove browser-side `execNode` shim behavior.
- Remove hidden PTY exec as a health-check mechanism.
- Remove playbook control from `preview-client.tsx`.
- Remove any API where `exec` ambiguously means both "run command" and "start long-running foreground process".

## Testing Strategy

Unit tests:

- `PaneSession.exec` waits for prompt and captures output.
- `PaneSession.sendLine` sends visible command and returns without prompt wait.
- `node.execFile` captures stdout, stderr, exit code, timeout, and reject behavior.
- `waitFor` retries, times out, and labels progress.
- Runtime cancellation prevents stale playbook updates.

Integration tests:

- Start preview server for a tiny demo.
- Connect a browser client.
- Verify panes render output from server-owned PTYs.
- Start playbook through browser control message.
- Verify playbook state reaches done.

Smoke tests:

- Record real examples.
- Assert video existence and duration.

## Open Decisions

- Whether the browser should still import the demo module for `render`, or whether the server should generate a lightweight browser entry that imports only the render export.
- Whether interactive preview user input should be enabled during an active playbook or disabled by default.
- Whether `node.execFile` should expose `env` directly or only a curated env merge.
- Whether `waitFor` should publish each failed probe as debug state or only publish the label.

## Acceptance Criteria

- Demo scripts run in Node, not in the browser.
- Browser still renders terminal panes with `@wterm/react`.
- Hidden health checks use Node child processes and never touch terminal pane state.
- Long-running visible commands use an explicit non-blocking pane API.
- Preview and record can run in parallel without port conflicts.
- Socket and Git/Vim examples record reliably in smoke tests.
- CI runs `vp check`, unit tests, build, and smoke tests.
