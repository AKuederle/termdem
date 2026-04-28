export function quoteShellArg(value: string) {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
