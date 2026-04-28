export const keys = {
  ARROW_DOWN: "\x1b[B",
  ARROW_LEFT: "\x1b[D",
  ARROW_RIGHT: "\x1b[C",
  ARROW_UP: "\x1b[A",
  BACKSPACE: "\x7f",
  CTRL_C: "\x03",
  CTRL_D: "\x04",
  CTRL_L: "\x0c",
  DELETE: "\x1b[3~",
  END: "\x1b[F",
  ENTER: "\r",
  ESC: "\x1b",
  HOME: "\x1b[H",
  PAGE_DOWN: "\x1b[6~",
  PAGE_UP: "\x1b[5~",
  SHIFT_TAB: "\x1b[Z",
  TAB: "\t",
} as const;

export type KeySequence = (typeof keys)[keyof typeof keys];
