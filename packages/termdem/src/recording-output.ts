import { extname } from "node:path";

export type RecordingFormat = "mp4" | "webm";

export function inferRecordingFormat(outputPath: string): RecordingFormat {
  const extension = extname(outputPath).toLowerCase();

  switch (extension) {
    case ".mp4":
      return "mp4";
    case ".webm":
      return "webm";
    default:
      throw new Error(
        `Unsupported recording format "${extension || "(none)"}". Supported formats: webm, mp4.`,
      );
  }
}
