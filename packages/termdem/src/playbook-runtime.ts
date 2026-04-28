import { execFile } from "node:child_process";
import { createPaneSession, type PaneSession } from "./pane-session.ts";
import { waitForPlaybookDelay } from "./playbook-wait.ts";
import type {
  TerminalDemoScript,
  TerminalDemoScriptApi,
  TerminalDemoSetup,
  TerminalDemoTeardown,
} from "./terminal-demo.ts";
import { typingDelays } from "./typing-delays.ts";
import type {
  ExecOptions,
  ExecResult,
  NodeExecOptions,
  NodeExecResult,
  PaneController,
  PressKey,
  TypeOptions,
  WaitForOptions,
} from "./types.ts";
import {
  createTerminalWorkspace,
  type TerminalWorkspace,
  type TerminalWorkspaceDefinition,
} from "./workspace.ts";

export type PlaybookState =
  | { state: "idle" }
  | { state: "running"; action?: string }
  | { state: "paused" }
  | { state: "stopped" }
  | { state: "done" }
  | { state: "error"; error: string };

export type RecordingState =
  | { state: "ready" }
  | { state: "started"; action?: string }
  | { state: "done" }
  | { state: "error"; error: string };

export type PaneRuntimeStatus = {
  pane: string;
  status: "ready" | "closed" | "error";
  message?: string;
};

export type PlaybookRuntimeOptions = {
  onPaneMeta?: (message: { cwd: string; pane: string; prompt: string; shell: string }) => void;
  onPaneOutput?: (message: { data: string; pane: string }) => void;
  onPaneStatus?: (status: PaneRuntimeStatus) => void;
  onPlaybookState?: (state: PlaybookState) => void;
  onRecordingState?: (state: RecordingState) => void;
  shell?: string;
  terminalDefinitions: readonly TerminalWorkspaceDefinition[];
  typeDelayMs?: number;
};

type ManagedPane = {
  session: PaneSession;
  workspace: TerminalWorkspace;
};

export type PlaybookLifecycle<Name extends string, SetupData = undefined> = {
  setup?: TerminalDemoSetup<Name, SetupData>;
  teardown?: TerminalDemoTeardown<Name, SetupData>;
};

export class PlaybookRuntime<Name extends string = string> {
  private readonly options: PlaybookRuntimeOptions;
  private readonly panes = new Map<string, ManagedPane>();
  private activeRun: Promise<void> | null = null;
  private generation = 0;
  private closed = false;
  private hiddenPaneOutputDepth = 0;
  private paused = false;
  private readonly resumeWaiters = new Set<() => void>();

  constructor(options: PlaybookRuntimeOptions) {
    this.options = options;
  }

  async ensureReady() {
    for (const terminal of this.options.terminalDefinitions) {
      if (this.panes.has(terminal.name)) {
        continue;
      }

      const workspace = await createTerminalWorkspace(terminal);
      const prompt = `(${terminal.name}) $ `;
      const shell = this.options.shell ?? process.env.TERMDEM_SHELL ?? "/bin/bash";
      const session = await createPaneSession({
        cols: 20,
        cwd: workspace.cwd,
        onOutput: (data) => {
          if (this.hiddenPaneOutputDepth > 0) {
            return;
          }

          this.options.onPaneOutput?.({ data, pane: terminal.name });
        },
        prompt,
        rows: 8,
        shell,
      });

      this.panes.set(terminal.name, { session, workspace });
      this.options.onPaneMeta?.({ cwd: workspace.cwd, pane: terminal.name, prompt, shell });
      this.options.onPaneStatus?.({ pane: terminal.name, status: "ready" });
    }

    this.options.onRecordingState?.({ state: "ready" });
  }

  async run(script: TerminalDemoScript<Name, undefined>): Promise<void>;
  async run<SetupData>(
    script: TerminalDemoScript<Name, SetupData>,
    lifecycle: PlaybookLifecycle<Name, SetupData>,
  ): Promise<void>;
  async run<SetupData = undefined>(
    script: TerminalDemoScript<Name, SetupData>,
    lifecycle: PlaybookLifecycle<Name, SetupData> = {},
  ) {
    if (this.activeRun) {
      return this.activeRun;
    }

    const run = this.runScript(script, lifecycle);
    this.activeRun = run;
    void run.finally(() => {
      if (this.activeRun === run) {
        this.activeRun = null;
      }
    });
    return run;
  }

  stop() {
    this.generation += 1;
    this.paused = false;
    this.resolvePauseWaiters();
    this.activeRun = null;
    this.publishPlaybookState({ state: "stopped" });
  }

  pause() {
    if (!this.activeRun || this.paused) {
      return;
    }

    this.paused = true;
    this.publishPlaybookState({ state: "paused" });
  }

  resume() {
    if (!this.paused) {
      return;
    }

    this.paused = false;
    this.resolvePauseWaiters();
    this.publishPlaybookState({ state: "running" });
  }

  async restart(script: TerminalDemoScript<Name, undefined>): Promise<void>;
  async restart<SetupData>(
    script: TerminalDemoScript<Name, SetupData>,
    lifecycle: PlaybookLifecycle<Name, SetupData>,
  ): Promise<void>;
  async restart<SetupData = undefined>(
    script: TerminalDemoScript<Name, SetupData>,
    lifecycle: PlaybookLifecycle<Name, SetupData> = {},
  ) {
    this.stop();
    await this.closePanes();
    this.closed = false;
    await this.run(script, lifecycle);
  }

  async resizePane(pane: string, cols: number, rows: number) {
    await this.readyPane(pane).resize(cols, rows);
  }

  async inputPane(pane: string, data: string) {
    const session = this.readyPane(pane);
    if (data === "\r") {
      await session.press("Enter");
      return;
    }

    await session.type(data, { typeDelayMs: 0 });
  }

  async waitFor(
    label: string,
    probe: () => Promise<boolean>,
    options: WaitForOptions = {},
    generation = this.generation,
  ) {
    const timeoutMs = options.timeoutMs ?? 30_000;
    const intervalMs = options.intervalMs ?? 250;
    const startedAt = Date.now();

    while (this.isCurrent(generation)) {
      if (await probe()) {
        return;
      }

      if (Date.now() - startedAt >= timeoutMs) {
        throw new Error(`Timed out waiting for "${label}"`);
      }

      await sleep(intervalMs);
    }

    throw new Error("Playbook stopped");
  }

  async close() {
    this.closed = true;
    this.generation += 1;
    this.paused = false;
    this.resolvePauseWaiters();
    await this.closePanes();
  }

  private createApi(
    generation: number,
    options: {
      defaultTypeDelayMs?: number;
      hiddenPaneExec?: boolean;
      publishActions?: boolean;
    } = {},
  ): TerminalDemoScriptApi<Name> {
    return {
      node: {
        exec: (file, args = [], options = {}) => execForPlaybook(file, args, options),
      },
      pane: (name) => this.createPaneController(String(name), generation, options),
      wait: async (delayMs) => {
        await this.ensureActive(generation);
        await waitForPlaybookDelay(delayMs, () => this.ensureActive(generation));
      },
      waitFor: (label, probe, options) => this.waitFor(label, probe, options, generation),
    };
  }

  private async runScript<SetupData = undefined>(
    script: TerminalDemoScript<Name, SetupData>,
    lifecycle: PlaybookLifecycle<Name, SetupData>,
  ) {
    const generation = ++this.generation;
    await this.ensureReady();
    this.publishPlaybookState({ state: "running" });
    this.options.onRecordingState?.({ state: "started" });
    let setupComplete = false;
    let setupData: SetupData | undefined;
    let runError: unknown;

    try {
      const setupApi = this.createApi(generation, {
        defaultTypeDelayMs: 0,
        hiddenPaneExec: true,
        publishActions: false,
      });
      setupData = (await this.runWithHiddenPaneOutput(() => lifecycle.setup?.(setupApi))) as
        | SetupData
        | undefined;
      setupComplete = true;
      await script(this.createApi(generation), setupData as SetupData);
    } catch (error) {
      runError = error;
    }

    if (setupComplete && lifecycle.teardown) {
      try {
        const teardownGeneration = this.closed ? generation : this.generation;
        const teardownApi = this.createApi(teardownGeneration, {
          defaultTypeDelayMs: 0,
          hiddenPaneExec: true,
          publishActions: false,
        });
        await this.runWithHiddenPaneOutput(() =>
          lifecycle.teardown?.(teardownApi, setupData as SetupData),
        );
      } catch (error) {
        runError ??= error;
      }
    }

    if (runError) {
      if (!this.isCurrent(generation) && formatError(runError) === "Playbook stopped") {
        return;
      }

      if (this.isCurrent(generation)) {
        const message = formatError(runError);
        this.publishPlaybookState({ state: "error", error: message });
        this.options.onRecordingState?.({ state: "error", error: message });
      }
      return;
    }

    if (this.isCurrent(generation)) {
      this.publishPlaybookState({ state: "done" });
      this.options.onRecordingState?.({ state: "done" });
    }
  }

  private createPaneController(
    name: string,
    generation: number,
    controllerOptions: {
      defaultTypeDelayMs?: number;
      hiddenPaneExec?: boolean;
      publishActions?: boolean;
    } = {},
  ): PaneController {
    const actionName = (method: string) =>
      controllerOptions.publishActions === false
        ? undefined
        : `pane(${JSON.stringify(name)}).${method}`;
    const defaultTypeDelayMs =
      controllerOptions.defaultTypeDelayMs ?? this.options.typeDelayMs ?? typingDelays.WPM_60;
    const withDefaultTypeDelay = (inputOptions?: TypeOptions) => ({
      ...inputOptions,
      typeDelayMs:
        inputOptions?.typeDelayMs ??
        controllerOptions.defaultTypeDelayMs ??
        this.options.typeDelayMs ??
        defaultTypeDelayMs,
    });

    return {
      cwd: async (): Promise<string> => {
        await this.ensureActive(generation, actionName("cwd"));
        return this.readyPane(name).cwd();
      },
      exec: async (command: string, options?: ExecOptions): Promise<ExecResult> => {
        await this.ensureActive(generation, actionName("exec"));
        if (controllerOptions.hiddenPaneExec) {
          return this.readyPane(name).execHidden(command);
        }
        return this.readyPane(name).exec(command, withDefaultTypeDelay(options));
      },
      press: async (key: PressKey): Promise<void> => {
        await this.ensureActive(generation, actionName("press"));
        if (controllerOptions.hiddenPaneExec) {
          await this.readyPane(name).pressHidden(key);
          return;
        }
        await this.readyPane(name).press(key);
      },
      sendLine: async (command: string, options?: TypeOptions): Promise<void> => {
        await this.ensureActive(generation, actionName("sendLine"));
        if (controllerOptions.hiddenPaneExec) {
          await this.readyPane(name).sendLineHidden(command);
          return;
        }
        await this.readyPane(name).sendLine(command, withDefaultTypeDelay(options));
      },
      type: async (text: string, options?: TypeOptions): Promise<void> => {
        await this.ensureActive(generation, actionName("type"));
        if (controllerOptions.hiddenPaneExec) {
          await this.readyPane(name).typeHidden(text, withDefaultTypeDelay(options));
          return;
        }
        await this.readyPane(name).type(text, withDefaultTypeDelay(options));
      },
    };
  }

  private readyPane(name: string) {
    const pane = this.panes.get(name);
    if (!pane) {
      throw new Error(`Pane "${name}" is not ready`);
    }

    return pane.session;
  }

  private async ensureActive(generation: number, action?: string) {
    if (!this.isCurrent(generation)) {
      throw new Error("Playbook stopped");
    }

    while (this.paused) {
      await this.waitUntilResumed();

      if (!this.isCurrent(generation)) {
        throw new Error("Playbook stopped");
      }
    }

    if (action) {
      this.publishPlaybookState({ state: "running", action });
      this.options.onRecordingState?.({ state: "started", action });
    }
  }

  private isCurrent(generation: number) {
    return !this.closed && generation === this.generation;
  }

  private publishPlaybookState(state: PlaybookState) {
    this.options.onPlaybookState?.(state);
  }

  private waitUntilResumed() {
    if (!this.paused) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.resumeWaiters.add(resolve);
    });
  }

  private resolvePauseWaiters() {
    const waiters = [...this.resumeWaiters];
    this.resumeWaiters.clear();
    for (const resolve of waiters) {
      resolve();
    }
  }

  private async runWithHiddenPaneOutput<T>(task: () => T | Promise<T>) {
    this.hiddenPaneOutputDepth += 1;
    try {
      return await task();
    } finally {
      this.hiddenPaneOutputDepth -= 1;
    }
  }

  private async closePanes() {
    const panes = [...this.panes.entries()];
    this.panes.clear();
    await Promise.all(
      panes.map(async ([name, pane]) => {
        try {
          await pane.session.close();
        } finally {
          await pane.workspace.dispose();
          this.options.onPaneStatus?.({ pane: name, status: "closed" });
        }
      }),
    );
  }
}

export function execForPlaybook(
  file: string,
  args: readonly string[] = [],
  options: NodeExecOptions = {},
): Promise<NodeExecResult> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      [...args],
      {
        cwd: options.cwd,
        env: options.env ? { ...process.env, ...options.env } : process.env,
        timeout: options.timeoutMs,
      },
      (error, stdout, stderr) => {
        const result = {
          exitCode: exitCodeFromExecFileError(error),
          stderr,
          stdout,
        };

        if (error && options.reject !== false) {
          reject(new Error(`${file} exited with code ${result.exitCode}`));
          return;
        }

        resolve(result);
      },
    );

    child.on("error", (error) => {
      if (options.reject === false) {
        resolve({ exitCode: 1, stderr: error.message, stdout: "" });
        return;
      }

      reject(error);
    });
  });
}

function exitCodeFromExecFileError(error: Error | null) {
  if (!error) {
    return 0;
  }

  if ("code" in error && typeof error.code === "number") {
    return error.code;
  }

  if ("signal" in error && typeof error.signal === "string") {
    return 128;
  }

  return 1;
}

function formatError(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

async function sleep(delayMs: number) {
  await new Promise((resolve) => setTimeout(resolve, delayMs));
}
