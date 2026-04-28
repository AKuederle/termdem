# termdem Examples

These examples are workspace packages that simulate how termdem should be used in a real project:
install `@akuederle/termdem` as a dev dependency, author a typed `demo.tsx`, and run the demo through
package scripts or the termdem CLI directly.

Each example lives in its own folder with a README, `package.json`, `tsconfig.json`, and `demo.tsx`.

- `git-vim`: single-pane Git workflow where file creation and editing happen through raw Vim keystrokes.
- `socket-cli`: multi-pane CLI workflow where one command returns a random local socket URL that drives later panes.

Recording size defaults live in each demo's `createTerminalDemo({ settings })` call. The
`record` CLI supports `--size <width>x<height>` for the browser viewport and output video size.
WebM recording does not require ffmpeg. MP4 output requires `ffmpeg` on `PATH`.

From an example package, the intended workflow is:

```bash
pnpm run previewDemo
pnpm run createDemo
```
