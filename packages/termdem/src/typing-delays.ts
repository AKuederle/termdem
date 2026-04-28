export const typingDelays = {
  WPM_30: 400,
  WPM_60: 200,
  WPM_80: 150,
  WPM_120: 100,
} as const;

export type TypingDelay = (typeof typingDelays)[keyof typeof typingDelays];
