/**
 * Pixel dimensions for a preview viewport or output video.
 */
export type DemoSize = {
  /** Height in CSS pixels. */
  height: number;
  /** Width in CSS pixels. */
  width: number;
};

/**
 * Recording and preview configuration for a demo.
 */
export type RecordingConfig = {
  /**
   * Final output video size.
   *
   * In preview, this size is also used as the fixed preview viewport when `viewportSize`
   * is not provided.
   */
  size?: DemoSize;
  /**
   * Default delay, in milliseconds, between visible typed characters.
   *
   * Individual `pane.type()`, `pane.exec()`, and `pane.sendLine()` calls can override this
   * with their own `typeDelayMs` option.
   */
  typeDelayMs?: number;
  /**
   * Browser viewport size used for preview and raw recording.
   *
   * Set this when you want to compose the demo at one size and scale/pad it into a
   * different final `size` during recording.
   */
  viewportSize?: DemoSize;
};

export type RecordingCliOptions = {
  size?: string;
  viewportSize?: string;
};

export type ResolvedRecordingConfig = {
  size: DemoSize;
  viewportSize: DemoSize;
};

const defaultSize: DemoSize = {
  height: 720,
  width: 1280,
};

export function parseDemoSize(value: string): DemoSize {
  const match = value.trim().match(/^(\d+)x(\d+)$/u);
  if (!match) {
    throw new Error(`Invalid size "${value}". Expected <width>x<height>, for example 1920x1080.`);
  }

  const width = Number(match[1]);
  const height = Number(match[2]);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid size "${value}". Width and height must be positive integers.`);
  }

  return {
    height,
    width,
  };
}

export function resolveRecordingConfig(
  demoConfig: RecordingConfig = {},
  cliOptions: RecordingCliOptions = {},
): ResolvedRecordingConfig {
  const hasCliSize = Boolean(cliOptions.size);
  const size = cliOptions.size ? parseDemoSize(cliOptions.size) : (demoConfig.size ?? defaultSize);

  return {
    size,
    viewportSize: cliOptions.viewportSize
      ? parseDemoSize(cliOptions.viewportSize)
      : hasCliSize
        ? size
        : (demoConfig.viewportSize ?? size),
  };
}
