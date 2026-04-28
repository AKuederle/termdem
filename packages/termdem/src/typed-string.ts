export type TypedStringOptions = {
  typeDelayMs?: number;
};

export type TypedString = {
  readonly kind: "termdem.typed-string";
  readonly options: TypedStringOptions;
  readonly text: string;
};

export type TypableSegment = string | TypedString;
export type TypableText = string | TypedString | readonly TypableSegment[];

export type NormalizedTypedSegment = {
  readonly text: string;
  readonly typeDelayMs?: number;
};

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
