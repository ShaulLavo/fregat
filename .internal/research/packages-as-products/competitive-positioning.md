# Competitive positioning, October 2026

Research for [Plan 336](../../../plans/336-packages-as-products.md), Track A/B input. It answers the
owner's worry that Fregat "just seems like a Cursor", that Singapore needs to stand apart from the
other browser editors, and checks whether ghostty-webgpu is as easy a sell as we think.

Collected 2026-10-08 with web search and fetches of current product pages and READMEs, plus a read of
our own READMEs, `ghostty-webgpu/docs/benchmarks.md`, `editor/docs/` and the 2026-10-08 terminal wave
report. Prices and star counts come mostly from third-party reviews dated June to October 2026; check
the vendor page before quoting a number publicly. Where only a third-party source exists, the table
says so. Evidence for our own claims is catalogued in
[performance-evidence.md](performance-evidence.md); this file does not repeat it.

**Summary.**

- **Fregat.** The things we list first today (open source, local, bring your own Claude Code and Codex,
  parallel sessions, one server for many clients, phone) are now table stakes. T3 Code, Paseo, Orca,
  Nimbalyst, Emdash and Jean all claim most of them, and several have native phone apps. The gap
  nobody fills is a complete, fast IDE (our own editor, terminal, language servers, git) that runs
  in the browser from your own machine, with the agents inside it. Orca, the closest product, puts
  VS Code's editor and xterm.js inside an Electron app. Sell the workbench and its speed, not the
  agent harness.
- **Singapore.** "A modern Monaco" is already the tagline of `esm-dev/modern-monaco`. CodeMirror
  already claims "responsive on huge documents" and ships collaborative editing. Our case is
  architecture you can measure: worker-side parsing and language servers, CSS Highlight API paint,
  and a persistent piece table with stable anchors. We do not yet have the head-to-head numbers to
  back it. A new entrant, `@pierre/diffs` edit mode, tells a similar "piece table + workers" story.
- **ghostty-webgpu.** It is the easiest sell, but only on claims we can prove: published
  benchmarks (no browser-terminal rival publishes any), parser throughput, scrollback memory, idle
  CPU, and four renderers. "Faster in every scenario" is false by our own data, and "as correct as
  Ghostty" is shared by every libghostty-vt wrapper.
- **Blockers before any "open source" claim.** Neither the fregat root nor `editor/` has a LICENSE
  file, and no Singapore package declares a `license` field. ghostty-webgpu is MIT.

---

## 1. Positioning maps and the sharpest angles

### 1.1 Fregat

#### Map

Two axes separate the field: how much of an IDE the product contains, and where the product runs.

```
                        full IDE (own editor, LSP, terminals, git)
                                        ▲
        Cursor · Windsurf/Devin Desktop │  Zed (native, ACP agents)
        Kiro · VS Code + Agents window  │
        Claude Code desktop (panes)     │            ★ Fregat
        Theia IDE                       │   (browser-native, your machine,
                                        │    every client on one server)
  closed / vendor cloud ◄───────────────┼───────────────► open / your machine
        Codex app · Cursor Glass        │  code-server, Coder (VS Code in a browser, no agent workbench)
        Conductor (Mac, closed)         │  Orca (Electron, VS Code editor + xterm)
        GitHub Codespaces (cloud)       │  T3 Code · Paseo · Nimbalyst · Emdash · Jean · opencode web
                                        ▼
                        agent control surface (chat, diffs, a terminal)
```

The lower-right quadrant (open, local agent control surfaces) holds dozens of projects
([awesome-agent-clients](https://github.com/YoanWai/awesome-agent-clients) lists about 100). The
upper-left belongs to funded closed IDEs. The upper-right, a full IDE that is open, runs on your
machine, and opens in any browser, holds only Zed (native desktop only; Delta threads open in a
browser, in private beta) and code-server (VS Code with no agent workbench). That is Fregat's space.

#### What is not ours alone (table stakes in 2026)

| Claim                                   | Already claimed by                                                                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| Open source                             | T3 Code (MIT), Orca (MIT), Paseo (Apache-2.0), Nimbalyst, Emdash, Jean, opencode, Zed                                                 |
| Bring your own Claude Code/Codex login  | T3 Code, Conductor, Orca, Paseo, Superset, Emdash, Zed (ACP), VS Code Agents window                                                   |
| Several agents side by side, worktrees  | Every product in section 2.1                                                                                                          |
| Runs on your machine / code stays local | Paseo ("Code stays on your machine"), T3 Code, Orca, Conductor                                                                        |
| One server, many clients                | T3 Code (web, Electron, iOS, Android), Paseo (desktop, web, iOS, Android, CLI)                                                        |
| Phone                                   | Native apps: T3 Code, Paseo, Orca, Nimbalyst, Claude (Dispatch), Codex (ChatGPT app), Cursor. Ours is the web app in a phone browser. |

None of these can lead the pitch. They belong in a "you also get" list.

#### The three sharpest angles

**1. A real IDE, served from your machine to any browser.** The agent control surfaces give you a
chat, a diff and a terminal. Fregat gives you the editor, language servers, terminals and git that
you would otherwise keep open in a second app, with the agents in the same panes. Orca and Claude
Code desktop come closest: Orca with "VS Code's editor" inside Electron, Claude Code desktop with a
file editor pane, closed source and Claude-only. code-server gives you VS Code in a browser with
no agent workbench.

- Line to test: "Your whole workbench, editor, terminals, git and agents, running on your machine
  and open in any browser."
- Evidence needed: a feature table against T3 Code, Paseo, Orca, Conductor and Claude Code desktop
  (rows: code editor, go to definition/LSP, integrated terminal, git staging, multiple agents, browser
  client, native desktop, terminal UI, phone, license), with a screenshot of each Fregat row. A short
  hero video of one session: edit, jump to a definition, run a terminal, hand a diff to Claude Code.

**2. Built for the browser, so it is fast in the browser.** Everyone else in the browser runs either
VS Code (code-server, Codespaces, vscode.dev, Theia) or a thin agent UI. Fregat's editor and terminal
were written for the browser: Singapore paints through the CSS Highlight API and parses in workers,
and ghostty-webgpu draws on the GPU and redraws only changed cells. This is the "every layer is ours"
point, said as a user benefit.

- Line to test: "Typing lands within one frame at 120 Hz" (only after it is measured).
- Evidence needed: a published, reproducible typing-latency and pane-switch trace for Fregat
  (`bun run agent:browser trace`), and a like-for-like comparison with code-server, the same
  VS Code engine Codespaces and Orca's editor use, on the same machine, file and browser.
  Comparing against Zed or Cursor desktop would not be like for like: Zed is native, and its
  "120 FPS" and "world's fastest IDE" lines own that ground.

**3. One workspace, every client, including a terminal UI and a native Mac app.** T3 Code and Paseo
share agent sessions across clients. Fregat shares the whole workspace (open files, terminals,
layout, git state, agents) between the browser, the desktop app, the native Mac client, a terminal
UI and a phone browser, all on one server. No product found offers a terminal UI client of the same
workspace.

- Line to test: "Start at your desk, pick it up from the couch: the same files, terminals and agents."
- Evidence needed: a 20-second video of one workspace open in the browser, the TUI and a phone at
  once, with one edit showing in all three. Document the remote-access path (Tailscale today).
  Name the gap honestly: Fregat has no native phone app, and T3 Code, Paseo and Orca do.

**Drop or demote:** "an open cursor" (README headline). It invites the comparison the owner wants to
avoid, and the "open-source Cursor alternative" label belongs to Void, which was archived in June 2026.

### 1.2 Singapore

#### Map

```
                     full IDE editor (LSP, many languages, large API)
                                     ▲
              Monaco / modern-monaco │  ★ Singapore (target)
              (VS Code core, ~1.5–4  │  (workers for parse + LSP, Highlight API,
               MB, main-thread DOM)  │   persistent piece table, modular packages)
                                     │
  heavier ◄──────────────────────────┼──────────────────────────► lighter
                                     │  CodeMirror 6 (~75–135 kB gz, OT collab,
       @pierre/diffs edit (beta,     │   huge-doc demo, MIT)
        Shiki, 298 grammars)         │  Ace · prism-code-editor
                                     ▼
                     embeddable component (snippets, playgrounds, notes)
```

Rich-text frameworks (Lexical, ProseMirror/Tiptap) are not in the code-editor market; they embed a
code editor in a code block. Zed's editor is native (GPUI) and has no browser build: GPUI has run
in WebAssembly since February 2026, and the only browser Zed is a community fork.

#### The three sharpest angles

**1. The main thread stays free: parsing, highlighting and language servers run in workers.**
CodeMirror parses with Lezer on the main thread in time slices, and stops highlighting partway down
very large documents to save work (its own huge-document demo says so). Monaco puts language services
in workers but runs its Monarch tokenizer on the main thread. Singapore moves tree-sitter parsing,
highlighting and the LSP client into workers. This needs checking against current Monaco and CM6
source before it is published.

- Line to test: "Parsing, highlighting and language servers run off the main thread, so typing never
  waits for them."
- Evidence needed: a main-thread busy-time trace while typing in a 500,000-line TypeScript file in
  Singapore, Monaco 0.57 and CodeMirror 6 (same file, same browser, same machine), plus keystroke
  input-to-frame latency for all three. The fixtures in `editor/examples/stress` exist; the Monaco and
  CM6 harness does not.

**2. Syntax colour without a span per token.** Singapore paints tokens through the CSS Custom Highlight
API, so a highlighted line stays one text node. Monaco and CodeMirror wrap every token in an element.
No other full code editor found uses the API; it shows up only in snippet highlighters
(`syntax-highlight-element`, blog demos).

- Line to test: "Syntax colour painted by the browser's Highlight API: no element per token."
- Evidence needed: DOM node count and style/layout time for the same viewport in all three editors;
  scroll frame times on a long minified line (the 1 MB-line fixture). Browser support line: Chrome
  105+, Safari 17.2+, Firefox 140+.

**3. Versions you can keep: a persistent piece table with stable anchors.** Every edit copies only
the changed tree path, so old versions stay readable for free and positions (diagnostics, cursors,
agent edits, comments) follow the text. Monaco's piece tree is mutable. CodeMirror 6's document is
also immutable and shares structure, so "snapshots" alone is not unique; the combination with
anchors and worker reads is. It is also the foundation for the planned collaboration design (Weidner's
"insert after ID" ordered by a server), which is simpler than CodeMirror's OT and Zed's CRDTs.

- Line to test: "Every version of the document stays readable, so workers, language servers and
  agents read a consistent snapshot while you keep typing."
- Evidence needed: text-buffer benchmarks against VS Code's piece tree (they exist and lose on random
  edits; publish them honestly), memory per retained snapshot, and a demo of an agent edit landing on
  a moved anchor. Collaboration stays "planned" with a link to the plan.

**Supporting points:** modular packages (core, tree-sitter, LSP, diff, minimap, markdown, find, React,
Solid), and "the editor inside Fregat" (Monaco's claim is "the editor that powers VS Code").

### 1.3 ghostty-webgpu

#### Map

```
                         published benchmarks, several renderers
                                       ▲
                                       │  ★ ghostty-webgpu (WebGPU, WebGL2,
                                       │    Canvas 2D, DOM; libghostty-vt)
   JS parser ◄─────────────────────────┼─────────────────────────► Ghostty's wasm core
     xterm.js 6 (DOM + WebGL addon;    │  restty (WebGPU + WebGL2, MIT, early)
      WebGPU addon PR #6137 open;      │  ghostty-web (Canvas, xterm API, last
      libghostty adoption #5686 open)  │   release 0.4.0 Dec 2025)
     hterm                             │  wterm (DOM only; Zig core or libghostty)
                                       ▼
                         no numbers published
```

#### The three sharpest angles

**1. The only browser terminal with a public, reproducible head-to-head benchmark.** ghostty-web,
restty and wterm publish no numbers; xterm.js's site does not use the word "fast". We publish method,
machine, commit, artifacts and the losses.

- Lines we can prove today (from `docs/benchmarks.md`, Apple M1, Chromium, 2026-10-01): parser
  throughput 2.6x xterm.js on ASCII and 5.2x on git logs (1.3x on Unicode and SGR); retained
  scrollback 0.40 MiB per 10,000 rows against 7.30 MiB for xterm.js (18x less); idle CPU about half
  of xterm.js WebGL (WebGPU against WebGL, so not same-API).
- Evidence needed: copy the 2026-10-08 renderer-by-renderer results from `/work/reports/` into
  `ghostty-webgpu/docs/benchmarks/` so they can be linked, and re-run idle CPU with instruction and
  energy counters (issue #925 clock-scaling skew).

**2. Four renderers that redraw only what changed.** WebGPU, WebGL2, Canvas 2D and DOM, with
damage tracking. restty has WebGPU and WebGL2, wterm has only DOM, ghostty-web has one canvas
renderer, xterm.js has DOM and WebGL. The DOM renderer covers accessibility and native selection, the
GPU renderers cover throughput, and fallback is automatic.

- Evidence needed: a renderer matrix (feature, browser support, when it is chosen) and one
  like-for-like row per renderer (WebGL against xterm WebGL, DOM against xterm DOM).

**3. Many terminals on one page.** Shared wasm runtime, per-terminal memory 0.21 MiB at 8 terminals
against 0.39 MiB for xterm WebGL, and output memory 1.6 against 7.5 MiB per terminal. Agent
workbenches open many terminals at once, so this matters to exactly the buyers (T3 Code, Orca,
Paseo, Coder) who embed xterm.js today.

- Evidence needed: the 17-terminal rows published, and the Pi 4 capacity observation re-run under
  equal conditions before it is quoted.

**Also true and sayable, but not ours alone:** "Ghostty's own terminal core (libghostty-vt), unpatched,
compiled to wasm." ghostty-web, restty and wterm's Ghostty core say the same; ghostty-web carries a
patch, which is a small, fair distinction.

---

## 2. Competitor tables

### 2.1 Fregat's competitors

| Product                                                                          | Headline (verbatim where quoted)                                    | Runs where                                                       | Models / subscriptions                                                                                                                     | Open source                                  | Clients and remote                                                                                                                | Speed claims                                                                 | Price                                                                                                                                   |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| [Cursor](https://cursor.com)                                                     | "Cursor is your coding agent for building ambitious software."      | Desktop app (VS Code fork); cloud agents; "Self-hosted machines" | Cursor's billing, many models; "Auto" and Composer models; no BYOK on the homepage                                                         | No                                           | Desktop, web agents (cursor.com/agent), mobile, CLI, Slack; Glass agent workspace (alpha, March 2026) with local-to-cloud handoff | None on the homepage                                                         | Hobby free, Pro $20, Pro+ $60, Ultra $200, Teams $40/$120 ([third-party, Sept 2026](https://www.lowcode.agency/blog/cursor-ai-pricing)) |
| Windsurf, now Devin Desktop                                                      | Renamed by Cognition 2026-06-02                                     | Desktop (VS Code fork)                                           | Own quotas                                                                                                                                 | No                                           | Desktop                                                                                                                           | n/a                                                                          | Free, Pro $20, Max $200, Teams $40 ([third-party](https://devtoolsreview.com/pricing/windsurf-pricing/))                                |
| [Zed](https://zed.dev)                                                           | "The world's fastest IDE. Open source. AI optional."                | Native desktop (GPUI); remote dev with local UI                  | BYOK, Zed-hosted models, external agents via ACP (Claude Agent, Codex, OpenCode, Cursor); terminal threads for Claude Code                 | Yes (GPL/AGPL/Apache mix)                    | Desktop only; Delta (Aug 2026, private beta) opens threads in a browser via wasm + WebGL                                          | "120 frames per second" (own blog); third-party "2 ms" figures are unsourced | Free editor; Pro and Business plans                                                                                                     |
| VS Code + Copilot                                                                | Agents window and Agent Sessions view                               | Desktop; vscode.dev (no agents found there)                      | Copilot plans include Claude and Codex agents; signed-out mode with Claude BYOK and ChatGPT-signed Codex is experimental (1.133, Aug 2026) | Code - OSS yes, Copilot no                   | Desktop, web, Codespaces                                                                                                          | n/a                                                                          | Copilot Free, Pro $10, Pro+ $39                                                                                                         |
| GitHub Codespaces                                                                | Hosted VS Code                                                      | GitHub cloud only, no self-hosting                               | Through Copilot                                                                                                                            | No                                           | Browser, desktop VS Code                                                                                                          | n/a                                                                          | 120 core-hours free; $0.18/core-hour after ([third-party](https://toolradar.com/tools/github-codespaces/pricing))                       |
| [code-server](https://github.com/coder/code-server) / [Coder](https://coder.com) | VS Code in the browser / self-hosted workspaces                     | Your server                                                      | Coder Agents (beta, May 2026); Coder Tasks retired from v2.37                                                                              | code-server MIT; Coder AGPL + Premium        | Browser                                                                                                                           | n/a                                                                          | code-server free; Coder Premium                                                                                                         |
| [opencode](https://opencode.ai)                                                  | "The open source AI coding agent"                                   | Local CLI, desktop (beta), `opencode web`, `opencode serve`      | "75+ LLM providers", Copilot and ChatGPT logins, Zen and Go subscriptions                                                                  | MIT, about 208k stars                        | TUI, desktop, web, IDE, ACP; client/server                                                                                        | None                                                                         | Free; Zen/Go paid                                                                                                                       |
| [T3 Code](https://github.com/pingdotgg/t3code)                                   | "agent harness control surface"                                     | Local server (`t3`), Electron desktop                            | "Works with your subscriptions on Claude Code, Codex, Cursor, Grok Build, OpenCode, and Google Antigravity."                               | MIT, about 26k stars                         | Web, desktop, iOS, Android; phones connect to your server                                                                         | "performant", no numbers                                                     | Free                                                                                                                                    |
| [Conductor](https://www.conductor.build)                                         | "Run parallel coding agents on your Mac."                           | Mac only; Firecracker cloud workspaces on Pro                    | Claude Code, Codex, Cursor, OpenCode, on your logins                                                                                       | No                                           | Mac app                                                                                                                           | None                                                                         | Free local; Pro $50, Teams $60 ([third-party](https://vibecoding.app/blog/conductor-review))                                            |
| Claude Code desktop and web                                                      | Code tab in Claude Desktop; parallel sessions (April 2026)          | Local, Cloud, SSH, WSL sessions                                  | Claude only, your Claude plan                                                                                                              | No                                           | Desktop, web, Dispatch from phone                                                                                                 | n/a                                                                          | Claude plans                                                                                                                            |
| Codex app                                                                        | "Build anything with Codex." / "The best way to build with agents." | Mac (Feb 2026), Windows; cloud tasks                             | Codex only, ChatGPT plans or API key                                                                                                       | App no (CLI is open)                         | Desktop, ChatGPT web and mobile, IDE, CLI                                                                                         | n/a                                                                          | Included in ChatGPT plans, Free to Pro $500 ([third-party, Oct 2026](https://munderdiffl.in/blog/codex-pricing/))                       |
| [Warp](https://www.warp.dev)                                                     | "Open infrastructure for cloud software factories"                  | Rust GPU terminal plus Oz cloud agents                           | "any model or harness (e.g. claude code or codex)"; BYO key on Build                                                                       | Terminal client MIT/AGPL                     | Desktop terminal, cloud                                                                                                           | None on the homepage                                                         | Free, Build $20, Max $200, Business $50                                                                                                 |
| Void                                                                             | Archived 2026-06-02                                                 | n/a                                                              | n/a                                                                                                                                        | Yes                                          | n/a                                                                                                                               | n/a                                                                          | Dead; a warning about the "open Cursor" position                                                                                        |
| [Kiro](https://kiro.dev)                                                         | "Move beyond AI coding to agentic engineering"                      | Desktop (Code OSS)                                               | Claude via Bedrock, credits                                                                                                                | No                                           | Desktop, CLI                                                                                                                      | None                                                                         | Free 50 credits; $20 to $200                                                                                                            |
| [Theia IDE](https://theia-ide.org)                                               | "AI-native IDE for cloud and desktop"                               | Desktop or browser                                               | Many providers, Claude Code integration, Copilot                                                                                           | EPL-2.0                                      | Browser and desktop                                                                                                               | None                                                                         | Free                                                                                                                                    |
| [Orca](https://www.onorca.dev)                                                   | "Ship 100x with the agent IDE"                                      | Electron desktop, SSH remotes                                    | "Plug in the subscriptions you already have" (27 agents)                                                                                   | MIT; claims 80k stars on X                   | Desktop, iOS, Android                                                                                                             | "dramatically faster than in any IDE", no numbers                            | Free                                                                                                                                    |
| [Paseo](https://paseo.sh)                                                        | "The agentic development environment"                               | Local daemon, optional E2E relay                                 | "Bring your subscriptions, skills and configuration"                                                                                       | Apache-2.0 per site (lists show AGPL; check) | Desktop, web, iOS, Android, CLI; one daemon                                                                                       | None                                                                         | Free                                                                                                                                    |
| Nimbalyst (was Crystal)                                                          | Visual workspace for Claude Code, Codex, OpenCode                   | Desktop                                                          | Your logins                                                                                                                                | MIT                                          | Desktop, web, iOS                                                                                                                 | None                                                                         | Free                                                                                                                                    |
| Emdash (YC W26)                                                                  | "the Open-Source Agentic Development Environment"                   | Desktop, SSH remotes                                             | 30+ agent CLIs                                                                                                                             | Apache-2.0                                   | Desktop                                                                                                                           | None                                                                         | Free                                                                                                                                    |
| Superset                                                                         | "Orchestrate any coding agent"                                      | Mac                                                              | Any CLI agent                                                                                                                              | Elastic-2.0 (source-available)               | Desktop                                                                                                                           | None                                                                         | Free                                                                                                                                    |
| Jean (coollabs)                                                                  | "A dev environment for AI agents."                                  | Tauri desktop or your server                                     | 9 agents                                                                                                                                   | Apache-2.0                                   | Desktop                                                                                                                           | None                                                                         | Free                                                                                                                                    |

**The white space.** Every open control surface runs someone else's editor (VS Code's, in Orca) and
terminal (xterm.js) or none at all. Every complete IDE is either closed and vendor-billed (Cursor,
Devin Desktop, Kiro), native-only (Zed), or VS Code in a browser without an agent workbench
(code-server, Codespaces, Theia). Fregat is the open, local, browser-native IDE whose editor and
terminal were built for that job, with Claude Code and Codex inside, and with the same workspace
in a terminal UI and a native Mac app. No product found publishes latency numbers for an agent
workbench, so measured speed is open ground.

### 2.2 Singapore's competitors

| Editor                                                    | Size                                                                                                                                                                                                      | Large files                                                                                                            | Workers                                                             | LSP                                           | Collaboration                                     | Framework adapters            | License                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- | ----------------------------- | --------------------------------------- |
| [Monaco](https://github.com/microsoft/monaco-editor) 0.57 | About 1.5 MB minimum main bundle per maintainer; 4 MB typical; TS worker 6.7 MB; 0.56 added tree-shakeable `monaco-editor/editor` entry ([#5154](https://github.com/microsoft/monaco-editor/issues/5154)) | Piece tree from VS Code; strong                                                                                        | Language services in workers; Monarch tokenizing on the main thread | Through monaco-languageclient                 | None built in (y-monaco)                          | Community React/Vue wrappers  | MIT                                     |
| [modern-monaco](https://github.com/esm-dev/modern-monaco) | Lazy core; size not published                                                                                                                                                                             | As Monaco                                                                                                              | Shiki pre-highlight while Monaco loads                              | Built-in providers for HTML, CSS, JS/TS, JSON | None                                              | n/a                           | MIT                                     |
| [CodeMirror 6](https://codemirror.net)                    | 250 kB min / 75 kB gzip minimal; about 135 kB gzip with a language (official bundling example)                                                                                                            | "Remains responsive even on huge documents and long lines"; million-line demo, highlighting stops partway to save work | No; incremental Lezer parsing on the main thread                    | Community packages                            | Yes, OT-style central authority, official example | Community (React, Solid, Vue) | MIT                                     |
| Ace                                                       | About 350 kB core (third-party)                                                                                                                                                                           | Fine; old model                                                                                                        | Workers for linting                                                 | Community                                     | Via plugins                                       | Community                     | BSD                                     |
| [@pierre/diffs](https://diffs.com) edit mode (beta)       | Large: one project measured 9.3 MB with 298 grammars                                                                                                                                                      | Piece table indexed by a treap; streamed appends                                                                       | Worker pool for highlighting                                        | No                                            | No                                                | React, web components, SSR    | Apache-2.0                              |
| prism-code-editor                                         | Smallest (textarea overlay)                                                                                                                                                                               | Not for large files                                                                                                    | No                                                                  | No                                            | No                                                | React, Solid, web components  | MIT                                     |
| Lexical / Tiptap code blocks                              | Part of rich-text frameworks                                                                                                                                                                              | Not for large files                                                                                                    | No                                                                  | No                                            | Yes (Yjs), for rich text                          | React and others              | MIT                                     |
| Sandpack / Bolt                                           | CodeMirror 6 inside                                                                                                                                                                                       | As CM6                                                                                                                 | Bundler in a worker or WebContainer                                 | No                                            | No                                                | React                         | Apache-2.0 / MIT                        |
| Zed editor                                                | Native; no browser build (GPUI wasm is experimental; one community fork)                                                                                                                                  | Rope on SumTree; strong                                                                                                | Native threads                                                      | Yes                                           | CRDT, built in                                    | n/a                           | GPL                                     |
| **Singapore**                                             | Measure and publish (gzip of core plus each package)                                                                                                                                                      | 500,000-line and 1 MB-line fixtures in `editor/examples/stress`                                                        | Tree-sitter, highlighting and LSP in workers                        | Yes, `lsp` and `lsp-plugin`                   | Planned (Weidner)                                 | React, Solid                  | **None declared. Add a LICENSE first.** |

### 2.3 ghostty-webgpu's competitors

| Terminal                                                       | Core                                          | Renderers                                                                                                                       | Size                 | Correctness basis                                                    | Features                                                                                                                                             | Benchmarks published            | License, activity                                                                                                                                             |
| -------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- | -------------------- | -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [xterm.js](https://github.com/xtermjs/xterm.js) 6.0 (Dec 2025) | JS parser and buffer                          | DOM, WebGL addon; WebGPU addon is an open PR ([#6137](https://github.com/xtermjs/xterm.js/pull/6137)) that claims no speed gain | Small JS             | Long track record; used by VS Code, JupyterLab, Theia, Replit, Azure | 13 official addons: attach, clipboard, fit, image, ligatures, progress, search, serialize, unicode-graphemes, unicode11, web-fonts, web-links, webgl | No                              | MIT; very active. Libghostty adoption proposed in [#5686](https://github.com/xtermjs/xterm.js/issues/5686) (Feb 2026, open, prototype "about the same" speed) |
| [ghostty-web](https://github.com/coder/ghostty-web) (Coder)    | libghostty-vt with a patch                    | Canvas                                                                                                                          | "~400KB WASM"        | Ghostty                                                              | xterm.js-compatible API; graphemes, XTPUSHSGR                                                                                                        | No                              | MIT, 3.0k stars; last release 0.4.0 Dec 2025; a report of wasm memory corruption after emoji                                                                  |
| [restty](https://github.com/wiedymi/restty)                    | libghostty-vt                                 | WebGPU, WebGL2 fallback                                                                                                         | Not stated           | Ghostty                                                              | Text shaping, panes, plugins, 50+ themes, shader stages, xterm compat wrapper, headless core                                                         | No                              | MIT, about 410 stars, "early-release"                                                                                                                         |
| [wterm](https://wterm.dev) (Vercel Labs)                       | Own Zig core (about 12 KB wasm) or libghostty | DOM only                                                                                                                        | 12 KB or 400 KB wasm | Zig core or Ghostty                                                  | React, Vue, Svelte; native selection, find, screen readers                                                                                           | No                              | Apache-2.0, experiment label                                                                                                                                  |
| hterm                                                          | JS                                            | DOM                                                                                                                             | n/a                  | Chrome OS lineage                                                    | Minimal                                                                                                                                              | No                              | BSD, slow-moving                                                                                                                                              |
| **ghostty-webgpu**                                             | libghostty-vt unpatched                       | WebGPU, WebGL2, Canvas 2D, DOM, damage-aware                                                                                    | Measure and publish  | Ghostty                                                              | Selection, scrollback with budgets, links, Unicode, themes, workers; addons planned                                                                  | **Yes**, with method and losses | MIT                                                                                                                                                           |

---

## 3. Taglines and how competitors phrase speed, local and bring-your-own

### 3.1 Headlines worth learning from

| Product      | Line                                                                                                                  | What it does well                                                                                                                   |
| ------------ | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Zed          | "The world's fastest IDE. Open source. AI optional."                                                                  | Three short claims, each a buying reason. The superlative has no number on the page; the 120 FPS blog posts carry it.               |
| Zed (remote) | "The UI runs fully locally to give you 120 frames per second"                                                         | Ties speed to a measurable unit.                                                                                                    |
| Conductor    | "Run parallel coding agents on your Mac."                                                                             | Verb, object, place. No adjectives.                                                                                                 |
| Paseo        | "Run many coding agents at once, on any machine. From your desk and from your phone."                                 | Says multi-device as a scene.                                                                                                       |
| Paseo        | "No telemetry, tracking, or forced login. Code stays on your machine."                                                | Local-first stated as facts the reader can check.                                                                                   |
| T3 Code      | "If they're set up on your computer, T3 Code can control them."                                                       | BYO subscription in one plain conditional.                                                                                          |
| Orca         | "Plug in the subscriptions you already have and run them side by side."                                               | Same, as a verb.                                                                                                                    |
| opencode     | "The open source AI coding agent" plus "16M developers every month"                                                   | Category name plus one social-proof number.                                                                                         |
| CodeMirror   | "Extensible Code Editor"; under Speed: "Remains responsive even on huge documents and long lines."                    | Feature grid of one-line facts. Modest and believed.                                                                                |
| Monaco       | "The Monaco Editor is the code editor that powers VS Code" (README)                                                   | Borrowed credibility from the host product. Singapore's equivalent: "the editor inside Fregat".                                     |
| xterm.js     | "Build terminals in the browser" plus a long "used by" list                                                           | Proof by adopters, not numbers. ghostty-webgpu cannot match this yet; numbers are our answer.                                       |
| wterm        | "renders to the DOM — native text selection, copy/paste, find, and accessibility come for free."                      | Turns an architecture choice into user benefits in one sentence. Model for Singapore's Highlight API line and for our DOM renderer. |
| ghostty-web  | "Ghostty for the web with xterm.js API compatibility"                                                                 | Name + migration path in one line. We need a migration guide and API table to compete.                                              |
| Ghostty      | "fast, feature-rich, and cross-platform terminal emulator that uses platform-native UI and GPU acceleration" (README) | Three adjectives, each backed by a page.                                                                                            |

### 3.2 Patterns

- **Speed.** Leaders state speed as a unit (Zed's 120 FPS) or a scene ("remains responsive on huge
  documents"), not as "blazing". The agent workbenches make speed claims with no numbers ("100x",
  "dramatically faster", "performant"). A published latency number from Fregat would be unusual in
  this category.
- **Local.** Phrased as concrete facts: "on your Mac", "Code stays on your machine", "doesn't send
  your code anywhere", "Your compute or ours". Not as "local-first", which is a developer term.
- **Bring your own.** Phrased as possession: "the subscriptions you already have", "your
  subscriptions", "If they're set up on your computer". Nobody names a price saving, likely because
  of Anthropic's terms (see traps).
- **Open source.** Either the first claim (opencode, Zed) or a closing line ("Free and open source."),
  always with the license name.

---

## 4. Traps

Claims a competitor already owns, or that invite an easy rebuttal.

### Fregat

1. **"Open source" with no LICENSE.** The fregat root has no LICENSE file. Anyone checking will see it
   in seconds. Add one before the word appears anywhere.
2. **"An open Cursor" / "Cursor alternative".** It is the comparison the owner wants to avoid, it is
   crowded (T3 Code calls itself an alternative to Claude Desktop, Codex App, Cursor Glass and
   Conductor; Orca compares itself to Warp, Kiro and Conductor), and the best-known holder, Void, died.
3. **Bring your own Claude subscription as a headline.** Fregat runs Claude through
   `@anthropic-ai/claude-agent-sdk` (`apps/server/package.json`). Anthropic's February 2026 legal text
   says subscription OAuth tokens may not be used "in any other product, tool, or service including the
   Agent SDK"; in May it announced moving Agent SDK use to a separate credit, then paused that on
   June 15, saying third-party use "still draw[s] from your subscription's usage limits"
   ([The New Stack](https://thenewstack.io/anthropic-pauses-claude-agent-sdk-subscription-change/)).
   The policy can change with notice. Say "runs Claude Code and Codex signed in the way you already
   use them" and link the vendors' current terms. Never promise savings.
4. **"Phone".** T3 Code, Paseo, Orca, Nimbalyst and Claude Dispatch have native phone apps. A
   responsive web app over Tailscale loses that comparison. Say "any browser, including your phone's".
5. **"Fastest" / "as fast as the browser can go".** Zed owns "world's fastest IDE"; any native editor
   beats a browser on raw latency. Our claim is about the browser: compare against code-server or
   Codespaces, like for like, and use a unit ("within one 120 Hz frame") only after it is measured.
6. **"Agentic development environment" / "ADE" / "agent IDE".** Used by Warp, Paseo, Emdash and Orca.
   Choosing it files Fregat in the crowded control-surface category.
7. **"Parallel agents", "worktrees", "side by side", "local", "one server, many clients".** Table
   stakes. Use them as supporting bullets, never as the reason to switch.
8. **"Seamless".** No number can back it, so Decision 2 rules it out. Show it in the hero video.

### Singapore

1. **"A modern Monaco".** It is the description of [modern-monaco](https://github.com/esm-dev/modern-monaco)
   ("A modern version of Monaco Editor"). It also invites a feature-parity check we lose today: our own
   [parity audit](../../../editor/docs/parity-monaco-codemirror.md) lists 101 findings, 47 missing
   (cut handler, text drag and drop, grapheme-aware movement, linked editing, bounded undo, and more).
   Try "an editor built the way Zed is built, for the browser" or a plain architecture line.
2. **"Handles huge files".** CodeMirror says it on its home page and has a million-line demo; Monaco
   inherits VS Code's piece tree. Only claim it with a head-to-head number.
3. **"Persistent snapshots" as unique.** CodeMirror 6's document is also immutable with structural
   sharing. Claim the combination (snapshots, anchors, worker reads), not snapshots alone.
4. **"Collaborative editing".** CodeMirror ships it; Zed ships CRDT collaboration. Ours is planned and
   must say so (Decision 3).
5. **"Small" or "lightweight".** `editor/packages/editor/dist` (published as `@singapore-editor/core`) is 11 MB on disk today, 4.6 MB without source maps, unminified, before gzip and tree-shaking. CodeMirror's
   75 kB gzip floor owns "small". Measure the gzip cost of core and each package before saying anything
   about size.
6. **"Faster than Monaco and CodeMirror".** No head-to-head harness exists. Our text buffer loses to
   VS Code's on random edits ([performance-evidence.md](performance-evidence.md)).
7. **No license.** No Singapore package declares one, and the standalone mirror has no LICENSE file.
   Nobody can adopt it as is.

### ghostty-webgpu

1. **"Faster than xterm.js and ghostty-web in every scenario".** False by our own data. In the
   published run, 1-terminal input latency p95 is 46.2 ms against 32.1 ms for xterm WebGL, and write
   p50 is 14.0 against 8.2 ms. In the 2026-10-08 wave, the WebGL renderer loses to xterm WebGL on
   Unicode (about 1.32x the energy) and line scrolling (about 1.36x), and the DOM renderer loses on
   edits (about 1.15x). Claim per workload and per renderer, and publish the losses beside the wins.
2. **"As correct as Ghostty" as a differentiator.** ghostty-web, restty and wterm's Ghostty core make
   the same claim. If xterm.js adopts libghostty ([#5686](https://github.com/xtermjs/xterm.js/issues/5686)),
   it disappears entirely. Keep it as a fact, not as the pitch.
3. **"Faster than ghostty-web".** ghostty-web has not released since December 2025 and only its parser
   was measured (every other column "unmeasured"). Beating it says little. Lead with xterm.js.
4. **"The WebGPU terminal".** restty is also WebGPU with WebGL2 fallback, and xterm.js has a WebGPU
   addon in review. Lead with "four renderers" and the numbers instead.
5. **xterm.js migration claims.** ghostty-web and restty both offer an xterm.js-compatible API, and
   xterm.js has 13 addons. Until we have a migration guide with an API mapping table and the common
   addons (fit, search, web links, serialize), "drop-in" or "replace xterm.js" will be checked and fail.
6. **Unpublished proof.** The newest renderer results live in `/work/reports/`, which is not public.
   Copy them into `ghostty-webgpu/docs/benchmarks/` before any README or site cites them.
7. **Name.** "Ghostty" is someone else's project name; ghostty-web uses it too, and the README already
   says "unofficial" and credits the artwork. Keep both, and do not use the Ghostty logo as ours.

---

## Sources

- Cursor: [cursor.com](https://cursor.com); pricing via [lowcode.agency](https://www.lowcode.agency/blog/cursor-ai-pricing), [vantage.sh](https://www.vantage.sh/blog/cursor-pricing-explained); Glass via [Cursor forum](https://forum.cursor.com/t/what-is-cursor-glass/155327), [MakerStack](https://makerstack.co/reviews/cursor-glass-review/)
- Windsurf / Devin Desktop: [devtoolsreview.com](https://devtoolsreview.com/pricing/windsurf-pricing/), [Cognition AI on Wikipedia](https://en.wikipedia.org/wiki/Cognition_AI)
- Zed: [zed.dev](https://zed.dev), [Introducing Delta](https://zed.dev/blog/introducing-delta), [builder.io review](https://www.builder.io/blog/zed-ai-2026), [GPUI on the web PR #50228](https://github.com/zed-industries/zed/pull/50228), [Run Zed in the browser discussion](https://github.com/zed-industries/zed/discussions/60629)
- VS Code / Copilot: [Agents window docs](https://code.visualstudio.com/docs/agents/run/agents-window), [multi-agent blog](https://code.visualstudio.com/blogs/2026/02/05/multi-agent-development), [VS Code 1.133 coverage](https://visualstudiomagazine.com/articles/2026/08/12/vs-code-1-133-flexes-claude-sessions.aspx), [issue #326510](https://github.com/microsoft/vscode/issues/326510)
- Codespaces and Coder: [toolradar](https://toolradar.com/tools/github-codespaces/pricing), [Coder Tasks docs](https://coder.com/docs/ai-coder/tasks), [InfoQ on Coder Agents](https://www.infoq.com/news/2026/05/coder-agents-self-hosted-ai/), [code-server changelog](https://github.com/coder/code-server/blob/main/CHANGELOG.md), [openvscode-server deprecation](https://info.linuxserver.io/issues/2026-07-16-openvscode-server/)
- opencode: [opencode.ai](https://opencode.ai), [InfoQ](https://www.infoq.com/news/2026/02/opencode-coding-agent/)
- T3 Code: [github.com/pingdotgg/t3code](https://github.com/pingdotgg/t3code)
- Conductor: [conductor.build](https://www.conductor.build), [vibecoding.app review](https://vibecoding.app/blog/conductor-review)
- Claude Code desktop: [docs](https://code.claude.com/docs/en/desktop), [MacRumors](https://www.macrumors.com/2026/04/15/anthropic-rebuilds-claude-code-desktop-app/); Anthropic subscription policy: [The New Stack](https://thenewstack.io/anthropic-pauses-claude-agent-sdk-subscription-change/), [DevOps.com](https://devops.com/anthropic-hits-pause-on-claude-agent-sdk-billing-change-for-now/), [AlternativeTo](https://alternativeto.net/news/2026/2/anthropic-officially-bans-using-subscription-authentication-for-third-party-claude-use)
- Codex: [openai.com/codex](https://openai.com/codex/), [CNBC launch](https://www.cnbc.com/2026/02/02/openai-codex-app-apple-computers.html), [pricing (third-party)](https://munderdiffl.in/blog/codex-pricing/)
- Warp: [warp.dev](https://www.warp.dev), [deployhq guide](https://www.deployhq.com/guides/warp)
- Void: [github.com/voideditor/void](https://github.com/voideditor/void), [status article](https://cursor-alternatives.com/blog/void-editor-development-status-2026/)
- Kiro: [kiro.dev](https://kiro.dev), [bitdoze review](https://www.bitdoze.com/kiro-ai-ide/)
- Theia: [theia-ide.org](https://theia-ide.org/), [1.74 notes](https://eclipsesource.com/blogs/2026/08/11/eclipse-theia-1-74-release-news-and-noteworthy/)
- Agent workbenches: [awesome-agent-clients](https://github.com/YoanWai/awesome-agent-clients), [Orca](https://www.onorca.dev), [Paseo](https://paseo.sh), [Emdash](https://github.com/generalaction/emdash), [Superset](https://superset.sh/), [Nimbalyst](https://github.com/nimbalyst/nimbalyst), [Jean](https://github.com/coollabsio/jean)
- Editors: [codemirror.net](https://codemirror.net), [CodeMirror bundling](https://codemirror.net/examples/bundle/), [huge doc demo](https://codemirror.net/examples/million/), [Monaco #5154](https://github.com/microsoft/monaco-editor/issues/5154), [Monaco changelog](https://github.com/microsoft/monaco-editor/blob/main/CHANGELOG.md), [modern-monaco](https://github.com/esm-dev/modern-monaco), [pistack comparison](https://www.pistack.xyz/posts/2026-08-22-browser-code-editors-monaco-codemirror-ace-comparison/), [diffs.com](https://diffs.com/), [Pierre editor review](https://www.codeline.co/thoughts/repo-review/2026/diffs-and-trees-the-component-library-behind-pierres-code-editor), [prism-code-editor](https://github.com/jonpyt/prism-code-editor), [MDN Custom Highlight API](https://developer.mozilla.org/en-US/docs/Web/CSS/Guides/Custom_highlight_API), [Sandpack](https://sandpack.codesandbox.io/)
- Terminals: [xtermjs.org](https://xtermjs.org), [xterm.js releases](https://github.com/xtermjs/xterm.js/releases), [WebGPU addon PR #6137](https://github.com/xtermjs/xterm.js/pull/6137), [libghostty proposal #5686](https://github.com/xtermjs/xterm.js/issues/5686), [ghostty-web](https://github.com/coder/ghostty-web), [restty](https://github.com/wiedymi/restty), [wterm](https://wterm.dev), [awesome-libghostty](https://github.com/Uzaaft/awesome-libghostty)
