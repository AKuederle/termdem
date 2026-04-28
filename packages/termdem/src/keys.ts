/**
 * Common terminal key sequences for scripted keyboard input.
 *
 * Use these constants with `pane.type()` or `pane.press()` when a demo needs to drive
 * an interactive terminal program such as Vim, a pager, or a readline prompt.
 *
 * @example
 * ```ts
 * await pane.sendLine("vim README.md");
 * await pane.type("i# Demo title");
 * await pane.type(keys.ESC);
 * await pane.type(":wq");
 * await pane.press(keys.ENTER);
 * ```
 */
export const keys = {
  /** Down arrow key. */
  ARROW_DOWN: "\x1b[B",
  /** Left arrow key. */
  ARROW_LEFT: "\x1b[D",
  /** Right arrow key. */
  ARROW_RIGHT: "\x1b[C",
  /** Up arrow key. */
  ARROW_UP: "\x1b[A",
  /** Backspace key. */
  BACKSPACE: "\x7f",
  /** Control-C. Commonly used to interrupt a foreground process. */
  CTRL_C: "\x03",
  /** Control-D. Commonly used to send end-of-input. */
  CTRL_D: "\x04",
  /** Control-L. Commonly used by shells to clear the screen. */
  CTRL_L: "\x0c",
  /** Delete key. */
  DELETE: "\x1b[3~",
  /** End key. */
  END: "\x1b[F",
  /** Enter or Return key. */
  ENTER: "\r",
  /** Escape key. */
  ESC: "\x1b",
  /** Home key. */
  HOME: "\x1b[H",
  /** Page Down key. */
  PAGE_DOWN: "\x1b[6~",
  /** Page Up key. */
  PAGE_UP: "\x1b[5~",
  /** Shift-Tab key. */
  SHIFT_TAB: "\x1b[Z",
  /** Tab key. */
  TAB: "\t",
} as const;

/**
 * Any supported key sequence from {@link keys}.
 */
export type KeySequence = (typeof keys)[keyof typeof keys];
