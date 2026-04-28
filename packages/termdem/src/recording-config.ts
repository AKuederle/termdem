export type DemoSize = {
  height: number;
  width: number;
};

export type RecordingConfig = {
  size?: DemoSize;
  typeDelayMs?: number;
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
