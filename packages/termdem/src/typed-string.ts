/**
 * Typing options for one composed text segment.
 */
export type TypedStringOptions = {
  /**
   * Delay, in milliseconds, between each character in this segment.
   *
   * Omit this to inherit the surrounding `pane.type()`, `pane.exec()`, or
   * `pane.sendLine()` delay.
   */
  typeDelayMs?: number;
};

/**
 * A text segment with typing behavior attached.
 *
 * Use `typedString()` to create values of this type. When composed with raw strings,
 * segments are concatenated exactly, so remember to include spaces in the surrounding
 * strings or in this segment when the terminal input needs spaces.
 */
export type TypedString = {
  readonly kind: "termdem.typed-string";
  readonly options: TypedStringOptions;
  readonly text: string;
};

/**
 * One segment accepted by pane typing APIs.
 */
export type TypableSegment = string | TypedString;

/**
 * Text accepted by pane typing APIs.
 *
 * A plain string uses the call-level typing delay. Arrays can mix raw strings with
 * `typedString()` segments to type some parts slowly and others instantly.
 */
export type TypableText = string | TypedString | readonly TypableSegment[];

export type NormalizedTypedSegment = {
  readonly text: string;
  readonly typeDelayMs?: number;
};

/**
 * Creates a text segment with optional typing behavior.
 *
 * @param text - Text to type for this segment. It is concatenated exactly with adjacent
 * segments, so include spaces where needed.
 * @param options - Segment-level typing options. These override the surrounding call's
 * `typeDelayMs` only when provided.
 */
export function typedString(text: string, options: TypedStringOptions = {}): TypedString {
  return {
    kind: "termdem.typed-string",
    options,
    text,
  };
}

export function normalizeTypableText(input: TypableText): NormalizedTypedSegment[] {
  const segments = Array.isArray(input) ? input : [input];

  return segments.map((segment) => {
    if (typeof segment === "string") {
      return { text: segment };
    }

    return {
      text: segment.text,
      typeDelayMs: segment.options.typeDelayMs,
    };
  });
}

export function typableTextValue(input: TypableText) {
  return normalizeTypableText(input)
    .map((segment) => segment.text)
    .join("");
}
