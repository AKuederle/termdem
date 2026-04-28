/**
 * Ready-made per-character typing delays for visible terminal input.
 *
 * The values are millisecond delays used by `pane.type()`, `pane.exec()`, and
 * `pane.sendLine()`. Pick a slower value when viewers need to read the command as it
 * is typed, or a faster value when the command is not the focus of the demo.
 *
 * @example
 * ```ts
 * export const demo = createTerminalDemo(terminals, async (api) => {
 *   await api.pane("main").exec("npm test");
 * }, {
 *   typeDelayMs: typingDelays.WPM_120,
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
  WPM_30: 250,
  /** Comfortable presentation speed. */
  WPM_60: 100,
  /** Brisk typing for commands that should still be readable. */
  WPM_80: 75,
  /** Fast typing for low-emphasis commands. */
  WPM_120: 50,
} as const;

/**
 * A per-character typing delay in milliseconds.
 */
export type TypingDelay = (typeof typingDelays)[keyof typeof typingDelays];
