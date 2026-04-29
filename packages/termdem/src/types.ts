import type { KeySequence } from "./keys.ts";
import type { PaneScreenSnapshot } from "./protocol.ts";
import type { TypableText } from "./typed-string.ts";

export type { PaneScreenSnapshot } from "./protocol.ts";

/**
 * Keys accepted by `pane.press()`.
 *
 * Use constants from {@link keys}, or the literal string `"Enter"` for readability.
 */
export type PressKey = "Enter" | KeySequence;

/**
 * Options for visible typed input.
 */
export type TypeOptions = {
  /**
   * Delay, in milliseconds, between each character.
   *
   * Pass `0` for instant input, use one of the `typingDelays` presets for a
   * natural typing pace, or provide a custom millisecond value.
   */
  typeDelayMs?: number;
};

/**
 * Options for commands run through `pane.exec()`.
 */
export type ExecOptions = {
  /**
   * Delay, in milliseconds, between each visible character of the command.
   *
   * This controls how the command appears to viewers before it is submitted. It does
   * not slow down the command process itself after Enter is sent.
   */
  typeDelayMs?: number;
};

/**
 * Result returned by `pane.exec()`.
 */
export type ExecResult = {
  /** The command string that was passed to `pane.exec()`. */
  command: string;
  /** The numeric process exit code. `0` usually means success. */
  exitCode: number;
  /** The captured terminal output before user-friendly cleanup. */
  raw: string;
  /** Captured command output with terminal control codes, prompt noise, and trailing blank lines removed. */
  text: string;
  /** `text` split into lines. This is useful for selecting values for later commands. */
  lines: string[];
  /** Unix timestamp, in milliseconds, when the command started. */
  startedAt: number;
  /** Unix timestamp, in milliseconds, when the command completed. */
  endedAt: number;
};

/**
 * Controls one visible terminal pane in a demo script.
 *
 * Get a controller with `api.pane("name")`, where `"name"` is one of the terminal
 * names passed to `createTerminalDemo()`.
 *
 * @example
 * ```ts
 * const pane = api.pane("main");
 *
 * const listing = await pane.exec("command ls -1 --color=never");
 * await pane.exec(`cat ${quoteShellArg(listing.lines[0]!)}`);
 * ```
 */
export interface PaneController {
  /**
   * Runs pane input through the same shell session without showing it in the terminal pane.
   *
   * Hidden pane work can read and mutate shell state such as exported variables and the
   * current directory. It still requires the pane shell to be ready for input.
   */
  hidden: HiddenPaneController;

  /**
   * Returns the latest current working directory observed for this pane.
   *
   * The value updates whenever the shell returns to a prompt, so it reflects completed
   * `exec()` commands that changed directory. Long-running foreground processes and
   * commands started with `sendLine()` may not update it until the prompt is shown again.
   *
   * @example
   * ```ts
   * await pane.exec("cd packages/termdem");
   * console.log(await pane.cwd());
   * ```
   */
  cwd(): Promise<string>;

  /**
   * Captures the pane shell's exported environment and current working directory.
   *
   * This is a snapshot taken by running a hidden command in the pane shell. It only
   * includes exported environment variables and requires the shell to be ready for input.
   */
  getEnv(): Promise<PaneEnvironment>;

  /**
   * Reads the terminal pane's current rendered screen.
   *
   * The snapshot reflects the terminal emulator buffer, so redraw-based programs such as
   * `watch`, dev servers with progress output, and full-screen terminal apps can be
   * inspected without waiting for a shell prompt.
   */
  screen(): Promise<PaneScreenSnapshot>;

  /**
   * Types raw text into the terminal as visible keyboard input.
   *
   * Use this for interactive programs where the script should not submit a complete
   * shell command, such as typing inside Vim or responding to a prompt.
   * Pass an array of strings and `typedString()` values to mix typing speeds. Raw
   * string segments use this call's `typeDelayMs`, then the demo-level `typeDelayMs`,
   * then the built-in default. `typedString()` segments inherit that same delay unless
   * they provide their own `typeDelayMs`. Segments are concatenated exactly, so include
   * spaces where the terminal input needs spaces.
   *
   * @param text - The exact text or terminal key sequence to send.
   * @param options - Optional typing speed settings for this input.
   *
   * @example
   * ```ts
   * await pane.sendLine("vim README.md");
   * await pane.type("i# Project notes");
   * await pane.type(keys.ESC);
   * ```
   */
  type(text: TypableText, options?: TypeOptions): Promise<void>;

  /**
   * Presses a single supported key or key combination.
   *
   * @param key - The key sequence to press. Use constants from `keys` for readability.
   *
   * @example
   * ```ts
   * await pane.type(":wq");
   * await pane.press(keys.ENTER);
   * await pane.press(keys.ESC);
   * ```
   */
  press(key: PressKey): Promise<void>;

  /**
   * Types a shell command visibly, submits it, waits for it to finish, and returns
   * cleaned command output.
   *
   * Use `exec()` when later script steps need the command result. Use `sendLine()`
   * instead for long-running commands that should keep running while the demo continues.
   * Pass an array of strings and `typedString()` values to mix typing speeds, for
   * example typing a command prefix slowly and pasting an argument instantly. Raw
   * string segments use this command's `typeDelayMs`, then the demo-level
   * `typeDelayMs`, then the built-in default. `typedString()` segments inherit that
   * same delay unless they provide their own `typeDelayMs`. Segments are concatenated
   * exactly into the shell command, so include spaces between segments where needed.
   *
   * @param command - The shell command to show and run in this pane.
   * @param options - Optional typing speed settings for the visible command text.
   * @returns The command exit code and captured output.
   *
   * @example
   * ```ts
   * const result = await pane.exec("node --version");
   * console.log(result.text);
   * ```
   */
  exec(command: TypableText, options?: ExecOptions): Promise<ExecResult>;

  /**
   * Types a shell command visibly and presses Enter without waiting for it to finish.
   *
   * Use this for servers, watchers, editors, and other foreground processes that should
   * remain active while the script sends later input or uses other panes.
   * Pass an array of strings and `typedString()` values to mix typing speeds. Raw
   * string segments use this call's `typeDelayMs`, then the demo-level `typeDelayMs`,
   * then the built-in default. `typedString()` segments inherit that same delay unless
   * they provide their own `typeDelayMs`. Segments are concatenated exactly before
   * Enter is sent, so include spaces between segments where needed.
   *
   * @param command - The shell command to type and submit.
   * @param options - Optional typing speed settings for the visible command text.
   *
   * @example
   * ```ts
   * await serverPane.sendLine("npm run dev");
   * await api.wait(1000);
   * await clientPane.exec("curl http://localhost:5173");
   * ```
   */
  sendLine(command: TypableText, options?: TypeOptions): Promise<void>;
}

/**
 * Hidden controls for a terminal pane.
 */
export interface HiddenPaneController {
  /** Hidden equivalent of `pane.type()`. */
  type(text: TypableText, options?: TypeOptions): Promise<void>;
  /** Hidden equivalent of `pane.press()`. */
  press(key: PressKey): Promise<void>;
  /** Hidden equivalent of `pane.exec()`. */
  exec(command: TypableText): Promise<ExecResult>;
  /** Hidden equivalent of `pane.sendLine()`. */
  sendLine(command: TypableText): Promise<void>;
}

/**
 * Exported pane shell environment captured at a point in time.
 */
export type PaneEnvironment = {
  /** Pane name the snapshot came from. */
  pane: string;
  /** Pane current working directory when the snapshot was captured. */
  cwd: string;
  /** Exported environment variables from the pane shell. */
  env: Record<string, string>;
};

/**
 * Options for `api.sidecar.exec()`, which runs a hidden sidecar process.
 */
export type SidecarExecOptions = {
  /** Working directory for the child process. Defaults to the preview server process directory. */
  cwd?: string;
  /** Environment variables for the child process. Defaults to the preview server process environment. */
  env?: NodeJS.ProcessEnv;
  /** Pane environment snapshot to use as the child process environment and cwd defaults. */
  environment?: PaneEnvironment;
  /**
   * Optional pane name associated with this background work in preview/recording status.
   *
   * This does not send output to that pane; it is only a label for demo progress.
   */
  pane?: string;
  /**
   * Whether to reject when the process exits with a non-zero code.
   *
   * Defaults to `true`. Set to `false` when a failing command is expected and should be
   * handled by inspecting the returned `exitCode`.
   */
  reject?: boolean;
  /** Maximum runtime in milliseconds before the process is stopped and reported as failed. */
  timeoutMs?: number;
};

/**
 * Result returned by `api.sidecar.exec()`.
 */
export type SidecarExecResult = {
  /** Numeric process exit code. */
  exitCode: number;
  /** Complete standard error output. */
  stderr: string;
  /** Complete standard output. */
  stdout: string;
};

/**
 * Options for `api.waitFor()`.
 */
export type WaitForOptions = {
  /** Delay, in milliseconds, between probe attempts. */
  intervalMs?: number;
  /** Maximum time, in milliseconds, to wait before failing the demo script. */
  timeoutMs?: number;
};

export type NormalizeExecCaptureOptions = {
  promptPattern?: RegExp;
};

export type NormalizedExecCapture = {
  raw: string;
  text: string;
  lines: string[];
};
