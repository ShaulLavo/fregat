# fregat

a dev environment for the agents you already pay for

![](docs/images/workbench.webp)

an editor, a terminal, git, language servers, and claude code and codex running inside it on your own subscriptions. like cursor, except you bring the provider. like t3 code, except it's the whole editor and not just the harness

sign in from inside the app. no accounts here, nothing proxied. run both agents at once, each in its own session with its own permission mode

the server does the filesystem, git and lsp work on your machine, so the same workspace opens from a browser, the desktop app, a terminal, or a phone over tailscale

no releases yet. clone it and run it

## try it

needs [bun](https://bun.sh) and at least one of

- claude code. `claude auth login`, or sign in from the app
- codex. install the [cli](https://developers.openai.com/codex/cli), `codex login`

```bash
bun install
bun run dev
```

open the url it prints, pick a folder

`bun run dev:web` skips the desktop app. `bun run dev:tui` is the terminal client, see the [tui guide](apps/tui/README.md)

## what's in it

- [singapore](https://github.com/ShaulLavo/singapore), the editor. written from scratch, not a vs code fork
- [ghostty-webgpu](https://github.com/ShaulLavo/ghostty-webgpu), the terminal. libghostty-vt in wasm, not xterm.js
- an elysia server that owns files, git, watching, language servers and the agent processes
- clients for web, electrobun desktop, native mac, and a tui

## more

- [development](docs/development.md), repo layout, linked checkouts, checks, deploys
- [filesystem boundaries](docs/filesystem-boundaries.md), what the editor can reach vs what agents can
- [settings reference](docs/settings-reference.md), generated from the registry
