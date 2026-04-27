#!/usr/bin/env node
import { inferRecordingFormat, type RecordingFormat } from "./recording-output.ts";
import { type RecordingCliOptions } from "./recording-config.ts";

export type PreviewCommand = {
  command: "preview";
  demoPath: string;
};

export type RecordCommand = {
  command: "record";
  cliOptions: RecordingCliOptions;
  demoPath: string;
  format: RecordingFormat;
  outputPath: string;
};

export type HelpCommand = {
  command: "help";
};

export type TermdemCommand = HelpCommand | PreviewCommand | RecordCommand;

export function parseTermdemCliArgs(argv: readonly string[]): TermdemCommand {
  const [command, ...args] = argv;

  switch (command) {
    case undefined:
    case "-h":
    case "--help":
    case "help":
      return { command: "help" };
    case "preview":
      return parsePreviewArgs(args);
    case "record":
      return parseRecordArgs(args);
    default:
      throw new Error(`Unknown command "${command}". Expected preview or record.`);
  }
}

export async function runTermdemCli(argv: readonly string[] = process.argv.slice(2)) {
  const command = parseTermdemCliArgs(argv);

  switch (command.command) {
    case "help":
      process.stdout.write(helpText());
      return;
    case "preview":
      throw new Error("The preview runtime is not wired into the packaged CLI yet.");
    case "record":
      throw new Error("The record runtime is not wired into the packaged CLI yet.");
    default:
      command satisfies never;
  }
}

function parsePreviewArgs(args: readonly string[]): PreviewCommand {
  if (args.length !== 1) {
    throw new Error("Usage: termdem preview <demo.tsx>");
  }

  return {
    command: "preview",
    demoPath: args[0]!,
  };
}

function parseRecordArgs(args: readonly string[]): RecordCommand {
  const positional: string[] = [];
  const cliOptions: RecordingCliOptions = {};

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]!;

    if (arg === "--size") {
      cliOptions.size = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }

    if (isViewportSizeFlag(arg)) {
      cliOptions.viewportSize = readFlagValue(args, index, arg);
      index += 1;
      continue;
    }

    if (arg.startsWith("-")) {
      throw new Error(`Unknown record option "${arg}".`);
    }

    positional.push(arg);
  }

  if (positional.length !== 2) {
    throw new Error(
      "Usage: termdem record <demo.tsx> <output.{webm|mp4}> [--size <width>x<height>] [--viewportSize <width>x<height>]",
    );
  }

  const [demoPath, outputPath] = positional as [string, string];
  return {
    cliOptions,
    command: "record",
    demoPath,
    format: inferRecordingFormat(outputPath),
    outputPath,
  };
}

function readFlagValue(args: readonly string[], index: number, flag: string) {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`Missing value for ${flag}.`);
  }

  return value;
}

function isViewportSizeFlag(arg: string) {
  return arg === "--viewportSize" || arg === "--viewportsize" || arg === "--viewport-size";
}

function helpText() {
  return `Usage:
  termdem preview <demo.tsx>
  termdem record <demo.tsx> <output.{webm|mp4}> [--size <width>x<height>] [--viewportSize <width>x<height>]
`;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runTermdemCli().catch((error: unknown) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  });
}
