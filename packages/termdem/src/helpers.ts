/**
 * Quotes one value so it can be safely inserted as a single POSIX shell argument.
 *
 * Use this when a value from an earlier command result needs to become part of a
 * later shell command. The returned string includes the surrounding quotes.
 *
 * @param value - The exact argument value to pass to the shell. It may contain spaces,
 * quotes, newlines, or other characters that would otherwise be interpreted by the shell.
 * @returns A single-quoted shell argument string.
 *
 * @example
 * ```ts
 * const listing = await pane.exec("command ls -1 --color=never");
 * const file = listing.lines[0]!;
 *
 * await pane.exec(`cat ${quoteShellArg(file)}`);
 * ```
 *
 * @example
 * ```ts
 * quoteShellArg("it's ready.txt");
 * // "'it'\\''s ready.txt'"
 * ```
 */
export function quoteShellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
