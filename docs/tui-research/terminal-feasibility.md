# Terminal feasibility

Verified on Linux on 2026-09-07 with OpenTUI 0.5.10, Bun, the real Platform server, and the native `@workspace/pty` implementation. The server runs in process in these tests. No additional listening development server is started.

| Gate                                       | Result     | Evidence                                                                                                                                                                                                           |
| ------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| S1 binary output and UTF-8                 | PASS       | `embedded.test.ts` feeds real `/terminal` frames into `EmbeddedTerminalRenderable`. A split emoji and CJK text paint correctly. Server tests preserve invalid bytes and trim truncated replay at a UTF-8 boundary. |
| S1 keys, paste, mouse, resize              | PASS       | Ctrl+C reaches the PTY as byte 3. Bracketed paste preserves a newline and CJK text. Mouse tracking emits SGR mouse coordinates. Relayout delivers the new PTY dimensions.                                          |
| S1 inner protocol negotiation              | PASS       | The embedded terminal answers the inner Kitty keyboard query. Neovim's mode 2048 resize negotiation works with server resize and reconnect repaint.                                                                |
| S1 alternate screen                        | PASS       | Synthetic alternate-screen entry and exit restore the previous screen. `native.test.ts` runs real Neovim, opens a second viewer at 60×20, verifies its first text line, and returns to the shell.                  |
| S1 headless React pane                     | PASS       | `pane.test.tsx` paints the real service output, forwards Ctrl+C, creates and closes independent sessions, restores the previous terminal, and creates a new terminal after closing the last one.                   |
| S5 raw attach and detach                   | PASS       | `host.test.ts` launches the actual interactive application inside a Linux host PTY. It attaches to a shell, runs Neovim, resizes to 120×40, and reads `40x120` from Neovim.                                        |
| S5 renderer and host restoration           | PASS       | The same host test detaches from running Neovim, creates another terminal through the resumed command dispatcher, exits the application, and verifies canonical input and echo restoration.                        |
| S5 cancellation and disconnect             | PASS       | `attach.test.ts` verifies listener removal, socket detachment, raw mode restoration, and one structured connection event after detach, abort, or socket loss.                                                      |
| Running development server with TUI origin | UNVERIFIED | The already-running server at port 3301 rejects the TUI origin under its older origin configuration. The tests exercise the current server with `TUI_CLIENT_ORIGIN`.                                               |
| htop                                       | UNVERIFIED | htop is not installed on this machine. Neovim supplies the native full-screen evidence.                                                                                                                            |

## Repaint and multiple viewers

A terminal session keeps a map of viewers. Output goes to every viewer, while replay goes only to the newly attached viewer. Closing one viewer leaves the process and other viewers alive. The detach expiry begins after the last viewer leaves. The latest resize sets the shared PTY dimensions.

Replay retains at most 256 KiB. Trimming drops leading UTF-8 continuation bytes at the retention boundary. Replay remains a byte history, not a terminal screen snapshot. A resize requests a new full-screen paint after attachment.

The native Neovim test exposed a gap in a SIGWINCH-only implementation. OpenTUI supports private mode 2048, and Neovim enables it. After that negotiation, Neovim expects an in-band size report. The server tracks DECSET and DECRST across output chunk boundaries and sends the report when it resizes the PTY. The tracker ignores OSC and other control-string contents. Report syntax follows the [in-band resize specification](https://gist.github.com/rockorager/e695fb2924d36b2bcf1fff4a3704bd83).

The repaint changes width by one column, then restores the requested size after the child emits output. A 50 ms fallback restores quiet terminals. This lets the child observe both dimensions instead of merging two synchronous SIGWINCH signals.

## Raw attach behavior

`runInteractive` suspends the renderer before opening the raw viewer and resumes it in `finally`. The embedded viewer continues consuming output while raw attach owns keyboard and terminal protocol responses. The host forwards bytes directly, including Ctrl+C and Ctrl+B.

Ctrl+] followed by `d` detaches. Two consecutive Ctrl+] bytes send one literal Ctrl+]. The decoder handles a prefix split between stdin chunks and discards trailing bytes after a detach command. Detachment closes the viewer and leaves the PTY alive.

Cleanup removes input, resize, output, state, and abort listeners. It restores raw input state and clears keyboard, mouse, paste, resize-report, cursor, and alternate-screen modes before renderer resume.

## Reproduction commands

From the repository root:

```sh
bun --cwd apps/tui --bun vitest run src/terminal/tests
bun --cwd apps/server --bun vitest run src/terminal/tests/service.test.ts
```

The native tests run when Neovim is installed. The real host test runs on Linux and reuses the existing job-control process fixture.
