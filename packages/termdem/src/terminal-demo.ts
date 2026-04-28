import type { CSSProperties, ReactElement } from "react";
import { type RecordingConfig } from "./recording-config.ts";
import {
  type NodeExecOptions,
  type NodeExecResult,
  type PaneController,
  type WaitForOptions,
} from "./types.ts";
import { type TerminalWorkspaceDefinition } from "./workspace.ts";

/**
 * Terminal definition accepted by `createTerminalDemo()`.
 *
 * Each definition creates one named pane that can be rendered in `render()` and controlled
 * from the demo script with `api.pane(name)`.
 */
export type TerminalDefinition = TerminalWorkspaceDefinition;

/**
 * Props accepted by generated terminal pane components.
 */
export type TerminalPaneProps = {
  /**
   * Additional CSS classes to apply to the pane frame.
   *
   * This is the usual place to set layout constraints such as `min-h-0`,
   * `min-w-0`, grid placement, or current-pane highlight styles.
   */
  className?: string;
  /**
   * Inline styles for the pane frame.
   *
   * Prefer `className` for normal styling. Use `style` when a value is computed
   * dynamically in the render function.
   */
  style?: CSSProperties;
};

/**
 * React component that renders one terminal pane.
 *
 * The component is created for you from the matching terminal definition name.
 */
export type TerminalPaneComponent = (props: TerminalPaneProps) => ReactElement;

/**
 * Named terminal pane components passed to a demo `render()` function.
 *
 * The object keys match the `name` fields from `createTerminalDemo()` so TypeScript can
 * catch missing or misspelled pane names.
 *
 * @example
 * ```tsx
 * export function render(panes: TerminalPaneComponents<typeof demo>) {
 *   return (
 *     <main className="grid h-full w-full grid-cols-2">
 *       <panes.server className="min-h-0 min-w-0" />
 *       <panes.client className="min-h-0 min-w-0" />
 *     </main>
 *   );
 * }
 * ```
 */
export type TerminalPaneComponents<TDemo> =
  TDemo extends TerminalDemo<infer TTerminals, string, any>
    ? Record<TTerminals[number]["name"], TerminalPaneComponent>
    : never;

type Awaitable<T> = T | Promise<T>;

/**
 * API passed to the script function provided to `createTerminalDemo()`.
 *
 * The script API is the main authoring surface for a demo. It lets the script select
 * visible panes, run hidden setup or readiness checks, and control timing.
 *
 * Use `TerminalDemoScriptApi` when extracting script helpers into named functions. The
 * `Name` type parameter should be the union of terminal names that helper accepts.
 *
 * @example Setup helper
 * ```ts
 * import type { TerminalDemoScriptApi } from "@akuederle/termdem";
 *
 * async function waitForServer(api: TerminalDemoScriptApi<"server" | "client">) {
 *   await api.waitFor("server is accepting requests", async () => {
 *     const result = await api.node.exec("curl", ["-fsS", "http://127.0.0.1:3000"], {
 *       reject: false,
 *       timeoutMs: 1000,
 *     });
 *
 *     return result.exitCode === 0;
 *   });
 * }
 * ```
 *
 * @example Full script
 * ```ts
 * export const demo = createTerminalDemo({
 *   panes: [
 *     { name: "server", pwd: workspace },
 *     { name: "client", pwd: workspace },
 *   ],
 *   script: async (api) => {
 *     await api.pane("server").sendLine("npm run dev");
 *     await waitForServer(api);
 *     await api.pane("client").exec("curl http://127.0.0.1:3000");
 *   },
 * });
 * ```
 */
export type TerminalDemoScriptApi<Name extends string> = {
  /**
   * Hidden Node-side helpers for setup, readiness checks, and other work that should
   * not be shown in a terminal pane.
   */
  node: {
    /**
     * Runs an executable as a hidden child process and returns its stdout, stderr, and exit code.
     *
     * Use this for background checks such as waiting for a server port, reading a fixture, or
     * preparing data that should not appear in the visible terminal transcript.
     *
     * @param file - Executable path or command name to run.
     * @param args - Arguments passed to the executable. Each array item is one argument.
     * @param options - Optional working directory, environment, timeout, and failure behavior.
     *
     * @example
     * ```ts
     * await api.waitFor("server ready", async () => {
     *   const result = await api.node.exec("curl", ["-fsS", "http://127.0.0.1:3000"], {
     *     reject: false,
     *     timeoutMs: 1000,
     *   });
     *
     *   return result.exitCode === 0;
     * });
     * ```
     */
    exec(
      file: string,
      args?: readonly string[],
      options?: NodeExecOptions,
    ): Promise<NodeExecResult>;
  };

  /**
   * Returns a controller for a visible terminal pane.
   *
   * @param name - Name of a terminal from the `panes` array passed to `createTerminalDemo()`.
   *
   * @example
   * ```ts
   * const server = api.pane("server");
   * await server.sendLine("npm run dev");
   * ```
   */
  pane(name: Name): PaneController;

  /**
   * Pauses the demo script for a fixed amount of time.
   *
   * Prefer `waitFor()` when waiting for a real condition. Use `wait()` for visual pacing,
   * short transitions, or giving an interactive app time to redraw.
   *
   * @param delayMs - Delay in milliseconds.
   */
  wait(delayMs: number): Promise<void>;

  /**
   * Repeatedly runs a probe until it returns `true` or times out.
   *
   * Use this instead of a fixed delay when waiting for an external service, file,
   * server port, or background process.
   *
   * @param label - Human-readable description shown in progress and timeout messages.
   * @param probe - Async function that returns `true` when the condition is ready.
   * @param options - Optional polling interval and timeout settings.
   *
   * @example
   * ```ts
   * await api.waitFor("API is accepting requests", async () => {
   *   const result = await api.node.exec("curl", ["-fsS", "http://127.0.0.1:3000"], {
   *     reject: false,
   *   });
   *
   *   return result.exitCode === 0;
   * }, {
   *   intervalMs: 250,
   *   timeoutMs: 30_000,
   * });
   * ```
   */
  waitFor(label: string, probe: () => Promise<boolean>, options?: WaitForOptions): Promise<void>;
};

export type TerminalDemoSetup<Name extends string, SetupData = unknown> = (
  api: TerminalDemoScriptApi<Name>,
) => Awaitable<SetupData>;

export type TerminalDemoScript<Name extends string, SetupData = undefined> = (
  api: TerminalDemoScriptApi<Name>,
  setupData: SetupData,
) => Awaitable<void>;

export type TerminalDemoTeardown<Name extends string, SetupData = undefined> = (
  api: TerminalDemoScriptApi<Name>,
  setupData: SetupData,
) => Awaitable<void>;

export type CreateTerminalDemoOptions<
  TTerminals extends readonly TerminalDefinition[],
  SetupData = undefined,
> = {
  /** Terminal panes available to the script and render function. */
  panes: TTerminals;
  /** Script that drives visible panes and hidden Node-side work. */
  script: TerminalDemoScript<TTerminals[number]["name"], SetupData>;
  /**
   * Hidden setup callback run before the visible demo script.
   *
   * It receives the same API as the script, but pane commands run without frontend output
   * and default to instant execution. Pane commands run in the same shell session used by the
   * visible script, so shell state such as exported environment variables persists. Its return
   * value is passed to the script.
   */
  setup?: TerminalDemoSetup<TTerminals[number]["name"], SetupData>;
  /**
   * Hidden teardown callback run after the visible demo script.
   *
   * It receives the same hidden API as setup and the setup return value.
   */
  teardown?: TerminalDemoTeardown<TTerminals[number]["name"], SetupData>;
  /** Recording and preview configuration for this demo. */
  settings?: RecordingConfig;
};

/**
 * Complete demo object exported from a demo file as `demo`.
 */
export type TerminalDemo<
  TTerminals extends readonly TerminalDefinition[],
  TName extends TTerminals[number]["name"] = TTerminals[number]["name"],
  TSetupData = undefined,
> = {
  /** Terminal panes available to the script and render function. */
  panes: TTerminals;
  /** Script that drives visible panes and hidden Node-side work. */
  script: TerminalDemoScript<TName, TSetupData>;
  /** Recording and preview configuration for this demo. */
  settings: RecordingConfig;
  /** Hidden setup hook run before the visible script. */
  setup?: TerminalDemoSetup<TName, TSetupData>;
  /** Hidden teardown hook run after the visible script. */
  teardown?: TerminalDemoTeardown<TName, TSetupData>;
};

/**
 * Creates the demo object exported by a termdem demo module.
 *
 * A demo module should export the returned value as a named `demo` export, and export
 * a separate `render()` function that lays out the generated pane components.
 *
 * @param options - Demo panes, script, optional lifecycle hooks, and optional recording
 * settings.
 * @returns A typed terminal demo object.
 *
 * @example
 * ```tsx
 * import {
 *   TmpDir,
 *   createTerminalDemo,
 *   typingDelays,
 *   type TerminalPaneComponents,
 * } from "@akuederle/termdem";
 *
 * const workspace = new TmpDir({});
 *
 * export const demo = createTerminalDemo({
 *   panes: [{ name: "main", pwd: workspace }],
 *   script: async (api) => {
 *     const main = api.pane("main");
 *     await main.exec("node --version");
 *   },
 *   settings: {
 *     size: { width: 1280, height: 720 },
 *     typeDelayMs: typingDelays.WPM_120,
 *   },
 * });
 *
 * export function render(panes: TerminalPaneComponents<typeof demo>) {
 *   return (
 *     <main className="grid h-full w-full bg-[#111] p-1">
 *       <panes.main className="min-h-0 min-w-0" />
 *     </main>
 *   );
 * }
 * ```
 */
export function createTerminalDemo<
  const TTerminals extends readonly TerminalDefinition[],
  const TSetupData = undefined,
>({
  panes,
  script,
  settings = {},
  setup,
  teardown,
}: CreateTerminalDemoOptions<TTerminals, TSetupData>): TerminalDemo<
  TTerminals,
  TTerminals[number]["name"],
  TSetupData
> {
  return {
    panes,
    script,
    settings,
    setup,
    teardown,
  };
}
