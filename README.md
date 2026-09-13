# fregat

a dev environment for the agents you already pay for

![the workbench editing its own source](docs/images/workbench.webp)

cursor gives you the whole environment and picks the model for you. t3 code lets you bring your own agents and stops at the harness. fregat is both halves. a real editor with real panes, a real terminal, git and language servers, and claude code and codex running inside it on the subscriptions you already have

you sign in from inside the app, against your own account. nothing proxies through anyone's server, and there is no account to make here. run both agents at once if you want, each in its own session, each with its own permission mode. claude gets full access, approval required, or auto accept edits. codex runs full access

it is local-first. the server does the filesystem, git and lsp work on your machine, and the client is just a client, so the same workspace opens from a laptop, a browser tab, a terminal, or a phone over tailscale

## what are you selling me

nothing. there is no product here, no pricing page, no waitlist. i wanted an editor that treats agents as a first-class pane instead of a chat box bolted to the side, and that does not make me rent a second subscription to use the first one

so it is worth saying plainly what this is not, yet. no releases, no installer, no stable api. you clone it and run it

## try it

you need [bun](https://bun.sh) and at least one agent

- claude code runs through the agent sdk. `claude auth login`, or start the sign-in from the app
- codex spawns the `codex` binary, so install the [codex cli](https://developers.openai.com/codex/cli) and `codex login`

```bash
bun install
bun run dev
```

`dev` brings up web, server and desktop. `bun run dev:web` skips the desktop app, `bun run dev:tui` gives you the terminal client against the server already running. see the [tui guide](apps/tui/README.md) for that one

open the url it prints, pick a folder, and you are in

## what it's made of

none of the interesting parts are forks

- [singapore](https://github.com/ShaulLavo/singapore) is the editor, written from scratch. piece table, css highlight api, tree-sitter and lsp as plugins. not a vs code fork
- [ghostty-webgpu](https://github.com/ShaulLavo/ghostty-webgpu) is the terminal, real ghostty compiled to wasm and painted on a canvas. not xterm.js
- the server is elysia, and it owns every side effect: files, git, watching, language servers, and the agent processes
- four clients speak to it: web, an electrobun desktop shell, a native swift app on mac, and a tui

both of those are sibling checkouts linked from source, so they are not vendored and not pinned to a release

## more

- [development](docs/development.md), the repo layout, the linked checkouts, the checks, and how deploys work
- [filesystem boundaries](docs/filesystem-boundaries.md), what the editor can reach and what agents can reach, which are not the same thing
- [settings reference](docs/settings-reference.md), every knob, generated from the registry
