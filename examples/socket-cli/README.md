# Socket CLI Demo

Multi-pane demo that simulates a small CLI-based client communication system.

The example contains two scripts:

- `scripts/server.mjs`: starts a local TCP message hub on a random port and prints the selected URL.
- `scripts/client.mjs`: connects to the hub either as a long-running listener or as a one-shot sender.

The demo proves a dynamic workflow:

1. The server pane runs `node scripts/server.mjs setup`.
2. That command starts the hub in the background and returns output like
   `CHAT_URL=tcp://127.0.0.1:54321`.
3. The script parses the URL from the captured `exec()` result.
4. The listener pane starts `node scripts/client.mjs listen <parsed-url>`.
5. The sender pane sends messages to the same parsed URL.
6. The listener pane visibly receives those messages.

This is the intended usage pattern for demos where one pane discovers runtime data and later panes
depend on it.

The demo config intentionally separates `size: 1920x1080` from `viewportSize: 1440x900` to document
the record contract. A future CLI can override both with `--size`, or override just the viewport with
`--viewportSize` in addition to `--size`.

Preview command once the CLI exists:

```bash
npx @akuederle/termdem preview ./examples/socket-cli/demo.tsx
```
