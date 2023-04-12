# clt

The testing tool allows you to run any commands and, after, repeat them and validate whether your result is valid.

## How to build rec and cmp tools

Build aarch and amd64 static cross for linux:

```bash
./bin/cross-build
git add .
git commit -m '...'
```

## How to make output readable

Oneliner to remove control chars and console codes/colors from recorded terminal output

```bash
cat output.rec | sed -e "s/\x1b\[.\{1,5\}m//g"
```

## Current limitations

- You should use `^D` only once when you close your `clt` environment; try to use `exit` for other exits.
- Avoid using `^C`, `^V`, `^Z`, and other magic controls because they will not work correctly.
- Reverse search is not supported now (`^R`), so do not use it to record.
- Finish your tests in `clt> ` shell and press `^D` to terminate the session and finish recordings.
- Use a simple default terminal, like iTerm. It may lead to strange behavior in VS Code terminal due to various settings in it.
- Currently, there is a limitation that you should enter commands only when prompt is available, which may result in incorrect result validation due to TTY workflow.

Not all keyboard and bash controls are supported. Here is the list of supported keystrokes:

- Input chars from the keyboard.
- Left and right arrows.
- Backspace and delete.
- CTRL+a and CTRL+e
