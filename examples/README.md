# termdem Examples

These examples are workspace packages that simulate how termdem should be used in a real project:
install `@akuederle/termdem` as a dev dependency, author a typed `demo.tsx`, and run the demo through
package scripts or the termdem CLI directly.

Each example lives in its own folder with a README, `package.json`, `tsconfig.json`, and `demo.tsx`.

- `git-vim`: single-pane Git workflow where file creation and editing happen through raw Vim keystrokes.
- `socket-cli`: multi-pane CLI workflow where one command returns a random local socket URL that drives later panes.

Recording size defaults live in each demo's `createTerminalDemo(..., config)` call. The future
`record` CLI should support `--size <width>x<height>` for the output video size and
`--viewportSize <width>x<height>` when the browser viewport should differ from the recorded video.
If only `--size` is passed, it applies to both recording and viewport size.

From an example package, the intended workflow is:

```bash
pnpm run previewDemo
```
