# brainless

<https://brainless.swerdlow.dev/> · repo <https://github.com/theswerd/brainless> · clone `references/brainless` (4c5d5ab)

## What it is

A shadcn registry of React components that recreate the terminal UIs of **Claude Code, Codex and Grok** in HTML. A page can then show a "screenshot" of an agent session as live, selectable, accessible DOM instead of an image or an iframe. The components are tuned against real captures. `tools/capture/capture.py` drives the real CLIs in 100×30 tmux sessions and snapshots each frame as `.ansi`, `.txt` and `.html` into `references/captures/`.

Semantics are real, not decoration. Tool calls are `<details>`. The permission prompt is an arrow-key radiogroup. The thinking line is an `aria-live` status. The prompt is a real `<input>`. Every animation handles `prefers-reduced-motion`.

## License, stack, deps

- MIT (Ben Swerdlow, 2026).
- Components import only `react` and `cn`. There is no Radix or lucide in the registry items; those appear only in the docs site. 36 components plus 5 blocks, about 4.4k lines total, each 30–220 lines.
- Styling is hardcoded hex colours (Tokyo Night-ish `#c0caf5`, Claude terra-cotta `#cd694a`), inline `style`, `text-[13px]` and injected `<style>` keyframes. That breaks every app design rule, so it belongs on the site only. The site's CSS is not scanned by `design:census`, whose roots are `apps/web/src`, `packages/ui/src` and `packages/markdown/src`.
- The docs site is Next 16 and shiki. Irrelevant to us.

## Catalog

| Family | Pieces                                                                                                                                                       | Link                                        |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------- |
| Claude | header, message, thinking, tool-call, todo-list, diff, permission, prompt, slash-menu                                                                        | <https://brainless.swerdlow.dev/components> |
| Codex  | header, message, exec, working, prompt, diff (pager), permissions, slash-menu                                                                                | same                                        |
| Grok   | status, header, message, event, thought, thinking, working, tool, write, permission, plan, project-picker, shortcuts, settings, turn-end, prompt, slash-menu | same                                        |
| Blocks | `claude-session`, `codex-session`, `grok-session`, `grok-session-active`, `pied-piper-onboarding` (scripted interactive flow)                                | <https://brainless.swerdlow.dev/blocks>     |

Registry: `https://brainless.swerdlow.dev/r/{name}.json`. Source: `references/brainless/registry/brainless/`.

## What the site has today

**`apps/site` exists.** It is Astro 5, with no React integration and no Tailwind. It has one page, `src/pages/index.astro` (321 lines), one component (`Drawing.astro`), hand-written `styles/global.css`, and deploys to GitHub Pages at `/fregat`.

- **Hero.** `#demo-frame` is an iframe that loads the whole web app built in `--mode demo`. `scripts/build-site.ts` runs `vite build` of `apps/web/demo.html`, backed by MSW handlers in `apps/web/src/demo/` (a simulated workspace, orchestration and terminal). The output `apps/site/dist/demo` is **31 MB, of which 26 MB is JS in 455 assets** (on disk, not transfer), plus the 773 KB ghostty wasm and a service worker. This is the "renders the real full editor a bit too much" part.
- **`#agents` section.** Two fake sessions ("claude code", "codex") written as plain `<ol>` markup and styled in `global.css` (`.sessions`, `.session`). This is already a hand-made, lower-fidelity brainless.
- A stray `console.log('dsdsd')` sits in the `index.astro` frontmatter (line 14).

## Landing demo

The idea: the hero shows a **scripted, pre-rendered replay** that loads in kilobytes. The real app demo moves behind a "try it live" click.

1. **Brainless blocks go into `#agents`, animated.** Replace the two static `<ol>` sessions with `ClaudeSession` and `CodexSession` side by side, driven by a script: typed prompt → todo list → Read tool call → diff → permission prompt → "✻ Percolating…". The copy the section already uses ("move the settings registry into contracts", "zustand declared, never installed") becomes the script.
2. **Hero becomes a lightweight fake workbench.** Compose panes in Astro with no app code:
   - file tree: static HTML
   - editor: Astro's built-in `<Code>` (Shiki at build time, zero JS) with a scripted cursor and diff highlight
   - terminal pane: `claude` running there, rendered with brainless Claude components, which is exactly how fregat shows a CLI agent in a PTY
   - chat pane: fregat's own look, hand-built in the site CSS

   The wallpaper and window chrome already exist (`.product-stage`, `.workbench`).

3. **One player for all of it.** Take the _idea_ in `blocks/pied-piper-onboarding.tsx` (`useTypewriter` plus a phase machine), not its code. Its phase logic uses nested ternaries. Instead, write a declarative timeline (`[{at, pane, action}]`) and a small player: rAF or `setTimeout`, pause while off-screen (IntersectionObserver), jump to the final frame under reduced motion, loop with a reset.
4. **The real demo stays, loaded lazily.** Keep `/demo/index.html` and the MSW backend behind the "run it live" button (click-to-load iframe or a new tab). The `fregat-demo-ready` postMessage handshake is unchanged.

**React or not.** Option A: add `@astrojs/react`, install brainless into `apps/site/src/components/brainless/`, and use `client:visible` islands, which costs about 45 KB gz of React on the page. Option B: port the ~10 needed components to `.astro` markup plus one vanilla player script. Most are static markup, and only thinking, prompt, permission and slash-menu hold state. **Recommend B.** The site has no React today, and the components are small enough to own.

## Steal list (ranked)

| #   | What                                                                                         | Where in platform                                                                                                | How                                                                                  |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 1   | `claude-*` and `codex-*` components for the `#agents` section and the hero terminal pane     | `apps/site/src/components/`                                                                                      | Copy the code (port to Astro), keep the hex palette on the site                      |
| 2   | Scripted-replay pattern (typewriter, phases, reduced-motion)                                 | `apps/site` hero                                                                                                 | Port the idea (declarative timeline)                                                 |
| 3   | tmux capture harness (`tools/capture`: fixed-size session, frame bursts, `.ansi/.txt/.html`) | `apps/tui` golden frames (tui-plan D16 `--headless-frame`), and faithful terminal content for the landing script | Port the idea                                                                        |
| 4   | Accessible disclosure for tool calls (`<details>`) and the radiogroup permission prompt      | `features/chat` tool rows and approval card                                                                      | Port the idea (we already have Base UI equivalents; compare keyboard behaviour only) |
| 5   | Grok components                                                                              | none                                                                                                             | Skip (we do not ship Grok)                                                           |

## Cost / risk

- Low. The code is MIT and dependency-free.
- It shows **other vendors' UIs** (Claude Code and Codex TUIs, including their names and glyphs). MIT covers the code, not the likeness or the marks. Showing them running inside fregat is fair depiction, but keep it clearly labelled.
- A replay is not the product. The hero must not claim to be interactive once the iframe is gone. The caption currently says "interactive demo", and should change to something like "replay · try it live".
- The captures in `references/captures` come from specific CLI versions and will drift from current Claude Code and Codex.

## Open questions

- Should the hero lead with the fake workbench (editor, terminal and chat composite), or with the agent sessions alone?
- Is the real demo iframe kept behind a click, or dropped from the site entirely (clone-and-run only)?
- Option A (React islands) or B (Astro port)? B is recommended.
