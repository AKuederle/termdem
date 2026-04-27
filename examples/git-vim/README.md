# Git Vim Demo

Single-pane demo that initializes a temporary Git repository, creates and modifies a file through
Vim keystrokes, and commits the result.

The important part is that the file content is not written by setup code or shell redirection. The
demo opens Vim and drives it with raw terminal input:

- `i` enters insert mode
- text bytes create the file
- `Esc` exits insert mode
- `:wq` writes and quits
- a second Vim session appends another line

The terminal workspace uses `new TmpDir({ setup })`, so every preview/restart gets a fresh repository.
`TmpDir` owns recursive cleanup when the terminal is disposed.

Preview command once the CLI exists:

```bash
npx @akuederle/termdem preview ./examples/git-vim/demo.tsx
```
