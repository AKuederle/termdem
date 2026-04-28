/**
 * Ready-made per-character typing delays for visible terminal input.
 *
 * The values are millisecond delays used by `pane.type()`, `pane.exec()`, and
 * `pane.sendLine()`. Pick a slower value when viewers need to read the command as it
 * is typed, or a faster value when the command is not the focus of the demo.
 *
 * @example
 * ```ts
 * export const demo = createTerminalDemo({
 *   panes,
 *   script: async (api) => {
 *     await api.pane("main").exec("npm test");
 *   },
 *   settings: {
 *     typeDelayMs: typingDelays.WPM_120,
 *   },
 * });
 * ```
 *
 * @example
 * ```ts
 * await pane.type("hello from vim", {
 *   typeDelayMs: typingDelays.WPM_60,
 * });
 * ```
 */
export const typingDelays = {
  /** Slow, deliberate typing. */
  WPM_30: 400,
  /** Comfortable presentation speed. */
  WPM_60: 200,
  /** Brisk typing for commands that should still be readable. */
  WPM_80: 150,
  /** Fast typing for low-emphasis commands. */
  WPM_120: 100,
  /** As fast as possible without triggering typical issue with key repeat */
  WPM_MAX: 20,
} as const;

/**
 * A per-character typing delay in milliseconds.
 */
export type TypingDelay = (typeof typingDelays)[keyof typeof typingDelays];
