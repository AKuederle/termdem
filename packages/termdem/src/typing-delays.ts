export const typingDelays = {
  WPM_30: 250,
  WPM_60: 100,
  WPM_80: 75,
  WPM_120: 50,
} as const;

export type TypingDelay = (typeof typingDelays)[keyof typeof typingDelays];
