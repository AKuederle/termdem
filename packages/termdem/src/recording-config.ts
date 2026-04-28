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
   * Demo viewport size.
   */
  size?: DemoSize;
  /**
   * Multiplier for the recording output size.
   *
   * Use this to record at a higher resolution while keeping the demo layout at `size`.
   */
  oversample?: number;
  /**
   * Default delay, in milliseconds, between visible typed characters.
   *
   * Individual `pane.type()`, `pane.exec()`, and `pane.sendLine()` calls can override this
   * with their own `typeDelayMs` option.
   */
  typeDelayMs?: number;
};

export type RecordingCliOptions = {
  oversample?: string;
  size?: string;
};

export type ResolvedRecordingConfig = {
  /** Recording output size passed to Playwright. */
  size: DemoSize;
  /** Browser viewport size used to lay out the demo. */
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

export function parseOversample(value: string): number {
  const oversample = Number(value.trim());
  if (!Number.isFinite(oversample) || oversample <= 0) {
    throw new Error(`Invalid oversample "${value}". Expected a positive number, for example 2.`);
  }

  return oversample;
}

export function resolveRecordingConfig(
  demoConfig: RecordingConfig = {},
  cliOptions: RecordingCliOptions = {},
): ResolvedRecordingConfig {
  const size = cliOptions.size ? parseDemoSize(cliOptions.size) : (demoConfig.size ?? defaultSize);
  const oversample = cliOptions.oversample
    ? parseOversample(cliOptions.oversample)
    : (demoConfig.oversample ?? 1);

  return {
    size: oversampledSize(size, oversample),
    viewportSize: size,
  };
}

function oversampledSize(size: DemoSize, oversample: number): DemoSize {
  return {
    height: Math.round(size.height * oversample),
    width: Math.round(size.width * oversample),
  };
}
