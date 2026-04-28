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
 *   const ServerPane = panes.server;
 *   const ClientPane = panes.client;
 *
 *   return (
 *     <main className="grid h-full w-full grid-cols-2">
 *       <ServerPane className="min-h-0 min-w-0" />
 *       <ClientPane className="min-h-0 min-w-0" />
 *     </main>
 *   );
 * }
 * ```
 */
export type TerminalPaneComponents<TDemo extends TerminalDemo<readonly TerminalDefinition[]>> =
  TDemo extends TerminalDemo<infer TTerminals>
    ? Record<TTerminals[number]["name"], TerminalPaneComponent>
    : never;

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
 *     const result = await api.node.execFile("curl", ["-fsS", "http://127.0.0.1:3000"], {
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
 * export const demo = createTerminalDemo([
 *   { name: "server", pwd: workspace },
 *   { name: "client", pwd: workspace },
 * ], async (api) => {
 *   await api.pane("server").sendLine("npm run dev");
 *   await waitForServer(api);
 *   await api.pane("client").exec("curl http://127.0.0.1:3000");
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
     *   const result = await api.node.execFile("curl", ["-fsS", "http://127.0.0.1:3000"], {
     *     reject: false,
     *     timeoutMs: 1000,
     *   });
     *
     *   return result.exitCode === 0;
     * });
     * ```
     */
    execFile(
      file: string,
      args?: readonly string[],
      options?: NodeExecOptions,
    ): Promise<NodeExecResult>;
  };

  /**
   * Returns a controller for a visible terminal pane.
   *
   * @param name - Name of a terminal from the `terminalDefinitions` array passed to
   * `createTerminalDemo()`.
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
   *   const result = await api.node.execFile("curl", ["-fsS", "http://127.0.0.1:3000"], {
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

/**
 * Complete demo object exported from a demo file as `demo`.
 */
export type TerminalDemo<
  TTerminals extends readonly TerminalDefinition[],
  TName extends TTerminals[number]["name"] = TTerminals[number]["name"],
> = {
  /** Recording and preview configuration for this demo. */
  config: RecordingConfig;
  /** Script that drives visible panes and hidden Node-side work. */
  script: (api: TerminalDemoScriptApi<TName>) => Promise<void> | void;
  /** Terminal panes available to the script and render function. */
  terminalDefinitions: TTerminals;
};

/**
 * Creates the demo object exported by a termdem demo module.
 *
 * A demo module should export the returned value as a named `demo` export, and export
 * a separate `render()` function that lays out the generated pane components.
 *
 * @param terminalDefinitions - Terminal panes available to the demo. Each item needs a
 * unique `name` and a workspace `pwd`. The names become keys in `panes` for `render()`
 * and valid names for `api.pane(name)` in the script.
 * @param script - Async function that performs the demo. Use `api.pane(name)` for
 * visible terminal actions, `api.node.execFile()` for hidden Node-side work, and
 * `api.waitFor()` for readiness checks.
 * @param config - Optional recording and preview configuration such as `size`,
 * `viewportSize`, and default `typeDelayMs`.
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
 * const workspace = new TmpDir();
 *
 * export const demo = createTerminalDemo(
 *   [{ name: "main", pwd: workspace }],
 *   async (api) => {
 *     const main = api.pane("main");
 *     await main.exec("node --version");
 *   },
 *   {
 *     size: { width: 1280, height: 720 },
 *     typeDelayMs: typingDelays.WPM_120,
 *   },
 * );
 *
 * export function render(panes: TerminalPaneComponents<typeof demo>) {
 *   const MainPane = panes.main;
 *   return (
 *     <main className="grid h-full w-full bg-[#111] p-1">
 *       <MainPane className="min-h-0 min-w-0" />
 *     </main>
 *   );
 * }
 * ```
 */
export function createTerminalDemo<const TTerminals extends readonly TerminalDefinition[]>(
  terminalDefinitions: TTerminals,
  script: (api: TerminalDemoScriptApi<TTerminals[number]["name"]>) => Promise<void> | void,
  config: RecordingConfig = {},
): TerminalDemo<TTerminals> {
  return {
    config,
    script,
    terminalDefinitions,
  };
}
