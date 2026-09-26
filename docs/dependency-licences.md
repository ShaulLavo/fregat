# Dependency licences and weight

Research round 2, 2026-09-26. Scope: Platform (`ShaulLavo/fregat`), the linked Editor
(`ShaulLavo/singapore`) and `ghostty-webgpu`, as they ship today.

## Headline

**Not clean, but nothing in the linked npm tree forces a licence on our code.** Of 337 packages that
reach a shipped artifact, 330 are MIT, ISC, Apache-2.0, BSD, 0BSD or BlueOak. The problems are
elsewhere:

1. **The web bundle ships GPL grammar files.** Shiki's full grammar set is emitted as lazy chunks.
   Five grammars are GPL-3.0 (ada, gnuplot, nginx, org, racket), one is LGPL-3.0 (ahk2), one
   registered theme is GPL-3.0 (aurora-x), three are MPL-2.0 (bird2, hcl, terraform), and 33 have
   no stated licence. They are on the mesh now, for example `assets/nginx-*.js`.
2. **Artwork with no confirmed licence sits in the public repo and in every release.** That is 12
   Omarchy wallpapers (16 MB), the Last Horizon workbench wallpaper, and two site images. The
   repo's own README says "Artwork redistribution remains unverified". The comment in
   `bundle-wallpapers.ts` says "Omarchy artwork is not redistributed", which stopped being true on
   09-20.
3. **We ship other people's MIT and Apache code without their notices.** There is no third-party
   notices file in any artifact except two t3code texts.
4. **Three runtime dependencies carry weak copyleft or proprietary terms.**
   - `web-push`, bundled into the server: MPL-2.0.
   - `sharp`'s libvips, a runtime external: LGPL-3.0.
   - `@anthropic-ai/claude-agent-sdk` and its 237 MB Claude binary, a runtime external: Anthropic's
     proprietary terms.

   All three are compliant as they are used today. Each can be removed or isolated.

None of the repos has a LICENSE file except `ghostty-webgpu`, which is MIT. See §2.

## Method

- **Web.** Every module id in the deployed release's `bundle-stats.json`: release
  `20260926T084449Z-bfc48ef1`, clean tree, Editor at `74e76bef`. That is 4,685 modules, which
  resolve to 252 packages from the Platform, Editor and ghostty `node_modules`.
- **Server.** The `// node_modules/...` path comments in the deployed `server/index.js` give 64
  bundled packages. The rest is the closure of `server/runtime/package.json` (sharp, the Claude
  Agent SDK, typescript, typescript-language-server): 14 more packages.
- **TUI.** The closure of `apps/tui` runtime dependencies (it runs from source under Bun): 65
  packages.
- **Desktop.** `electrobun`.
- **Licence evidence.** For each package I read the `package.json` licence field and classified
  every `LICENSE*`/`COPYING*`/`NOTICE*` file by its text, without trusting the field alone.
- **Dev-only check.** I scanned all 1,201 installed packages across the three repos the same way.
- **Shiki grammar and theme licences.** From `tm-grammars@1.32.3` and `tm-themes` metadata,
  matched against the 327 Shiki chunks in the build. Flagged repos were re-checked with the GitHub
  API.
- **Language servers.** Licences from the GitHub API for each repo in
  `apps/server/src/lsp/registry.ts`.
- **Scripts.** Everything is in `/work/tmp/research2/licences/`: `audit.ts`, `all.ts`, `tm.mjs`,
  `weight.ts`, `sweight.ts`, `attrib.ts`, `closure-size.ts`, `first.ts`, `dup.ts`, plus the
  outputs `audit.json` and `weight-web.txt`.

## 1. Licence audit

### 1a. Flags that need a decision or an action

Each flag gives what it is, where it ships, why that matters, and the options.

**Shiki grammars and a theme under GPL, LGPL, MPL or no licence**

- **What:** `@shikijs/langs` and `@shikijs/themes` 4.4.3.
  - `packages/markdown/src/utils/shiki-highlighter.ts` imports `bundledLanguages` from
    `shiki/langs`, so every grammar becomes a chunk.
  - `packages/client-core/src/themes/registration.ts` registers `aurora-x`.
  - The TUI imports `bundledLanguages` and `bundledThemes` in `apps/tui/src/viewer/state/syntax.ts`.
- **Where it ships:** bundled. The files are lazy web chunks, served to every browser that asks
  and present in every release. The TUI loads the same grammars from `node_modules`.
- **The grammars:**
  - GPL-3.0: ada, gnuplot, nginx, org, racket, and the theme aurora-x.
  - LGPL-3.0: ahk2.
  - MPL-2.0: bird2, hcl, terraform.
  - No licence (21) or NOASSERTION (12), 33 in all: abap, apache, apex, apl, applescript,
    asciidoc, cue, dax, dream-maker, elixir, erb, glsl, hurl, kusto, llvm, logo, luau, matlab,
    mipsasm, nim, nsis, po, purescript, rel, sass, sparql, ssh-config, tcl, toml, ts-tags, turtle,
    wolfram, yaml.
- **Why it matters:** a GPL grammar is data loaded at runtime, so the usual reading is
  aggregation, not a combined work. But shipping it still means distributing GPL files, and that
  is what a permissive-only policy exists to avoid. MPL is file-level: the files are unmodified
  and public, so the only duty is the notice. "No licence" means all rights reserved by the
  grammar's author. The textmate/* bundles (yaml, toml, erb and others) are in this group.
- **Options:**
  - Generate an explicit grammar and theme map, filtered by licence, in place of
    `bundledLanguages`/`bundledThemes`, and gate it. This also cuts 8.4 MB of lazy JS (§3).
  - Drop only the copyleft ones.
  - Keep everything.

**Wallpapers and site art without a verified licence**

- **What:**
  - The 12 images in `apps/server/src/themes/wallpapers/assets/`, copied into `server/assets/`
    in every release.
  - `apps/web/public/workbench/wallpaper.jpg`. Its source file says "The original image artist is
    not identified".
  - `apps/site/src/assets/eyes-wide.jpg` and `garden.jpeg`.
- **Where it ships:** committed to a public repo, and bundled into the server and web releases.
- **Why it matters:** the Omarchy repo is MIT, but it does not document where each image came
  from. Several are third-party art that Omarchy cannot relicense. Redistributing art we don't
  have rights to is plain copyright exposure, not a licence-compatibility question.
- **Options:**
  - Go back to seeding from `/usr/share/omarchy/themes/*/backgrounds` at boot when present.
    `BUNDLED_WALLPAPERS` already names images by hash, so they resolve after the seed.
  - Replace the images with ones we own or CC0 images.
  - Keep them and chase a licence for each image.
  - In every case the comment in `packages/contracts/src/themes/bundle-wallpapers.ts` has to
    change.

**Missing attribution for code and assets we ship**

- **What:**
  - `packages/tree` is a fork of Pierre's trees and path-store (Apache-2.0, see
    `packages/tree/UPSTREAM.md`). There is no copy of the licence, and the modified files have no
    change notices.
  - `apps/web/src/lib/vscode-icon-glyphs.ts` (58 KB of glyphs) and the favicon
    `apps/web/public/vscode-icons/code.svg` are Pierre VS Code Icons (MIT). I confirmed this by
    matching paths in `references/pierre-vscode-icons/svgs`.
  - There are t3code ports (MIT), for example `features/chat/utils/artifact-templates.ts` and
    several "Ported from upstream" server modules. Only `command-label.LICENSE` and the
    notification sounds carry the t3code notice.
  - `packages/ui/src/styles/shadcn-tailwind.css` (shadcn, MIT).
  - Inter and JetBrains Mono (OFL-1.1) woff2 files are in `web/assets`. OFL requires the licence
    text to go with the font.
  - Every bundled npm package loses its licence text when minified.
- **Where it ships:** bundled into web and server.
- **Why it matters:** MIT and Apache ask for one thing, keep the notice. Apache §4 also wants a
  copy of the licence and "prominent notices" on files we changed. This duty exists today
  whatever licence we choose for our own code.
- **Options:** generate `THIRD_PARTY_NOTICES` at build time from the same inputs this audit used
  (`bundle-stats.json`, the server path comments, the runtime lock), and serve it at
  `/licenses/`. Add `packages/tree/LICENSE-pierre` plus a header line on the forked files, and
  `OFL.txt` for the fonts.

**`web-push` 3.6.7 (MPL-2.0)**

- **What:** VAPID key generation and request encryption, used in `apps/server/src/push/vapid.ts`
  and `delivery.ts`.
- **Where it ships:** bundled into `server/index.js`: 219 KB exclusive, 17 packages including
  `bn.js`, `asn1.js`, `jws` and `http_ece`.
- **Why it matters:** MPL is file-level copyleft. We use it unmodified, so shipping the server
  bundle (Plan 151 ships releases to other machines) only needs the notice and a pointer to the
  source. It becomes a problem only if someone edits those files.
- **Options:**
  - Replace it with WebCrypto: an ES256 VAPID JWT plus RFC 8291 `aes128gcm`, about 150 lines.
    This drops MPL and 17 packages.
  - Keep it and list it in the notices file.

**`sharp` 0.35.4 with `@img/sharp-libvips-*` 1.3.3 (LGPL-3.0-or-later)**

- **What:** wallpaper decode and thumbnails, one site: `apps/server/src/themes/wallpapers/decode.ts`.
- **Where it ships:** a runtime external, installed from npm on each host by
  `runtime/package.json`. libvips is a separate shared library in its own package.
- **Why it matters:** LGPL with dynamic linking to an unmodified, replaceable library is
  compliant. The cost is 38.5 MB, a per-platform binary install, and a copyleft entry in the tree.
- **Options:**
  - Replace it with `Bun.Image`, built into Bun 1.4.0. A probe here decoded a 6001×4001 JPEG,
    read its metadata and wrote WebP in 33 ms. Parity needs checking for `limitInputPixels`, the
    timeout and the multi-page check.
  - Keep it.

**`@anthropic-ai/claude-agent-sdk` 0.3.281 (proprietary)**

- **What:** "© Anthropic PBC. All rights reserved", governed by Anthropic's legal agreements. The
  `-linux-x64` and `-linux-x64-musl` packages each hold a 237 MB `claude` binary. Install size is
  451 MB, both libc variants included.
- **Where it ships:** a runtime external, installed from npm on each host. We never copy it
  ourselves. It runs as a separate process.
- **Why it matters:** it is the Claude provider itself. No permissive alternative exists for a
  proprietary service.
- **Options:**
  - Keep it as a named exception.
  - Drive the user-installed `claude` CLI directly and drop the SDK dependency. The server already
    has an installed-CLI resolver.

**`intelephense` (proprietary, "SEE LICENSE IN LICENSE.txt")**

- **What:** the PHP language server. `apps/server/src/lsp/registry.ts` `php intelephense` runs
  `bun add intelephense` into the tool root on first use.
- **Where it ships:** spawned as a separate process, downloaded by the user's server from npm.
- **Why it matters:** we auto-install proprietary software for the user without showing its
  terms.
- **Options:**
  - Only use it when it is already on PATH, with no auto-download.
  - Switch to phpactor (MIT, needs PHP).
  - Keep it.

### 1b. Checked and fine, noted for the record

| Item                                                                                                                                                                             | Licence                                              | Why it is fine                                                                                                                                                                                                                                                                 |
| -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `dompurify` 3.4.13 (web, via mermaid)                                                                                                                                            | MPL-2.0 OR Apache-2.0                                | Dual licence; take Apache-2.0                                                                                                                                                                                                                                                  |
| `jszip` 3.10.2 (server)                                                                                                                                                          | MIT OR GPL-3.0-or-later                              | Dual licence; take MIT                                                                                                                                                                                                                                                         |
| `minimatch` 10.2.6 (web first-load, server)                                                                                                                                      | BlueOak-1.0.0                                        | Permissive                                                                                                                                                                                                                                                                     |
| `khroma` 2.1.0 (web, via mermaid)                                                                                                                                                | no field; `license` file is MIT                      | MIT                                                                                                                                                                                                                                                                            |
| `boolbase`, `drizzle-orm`, `http_ece`, `react-remove-scroll-bar`, `rehype-katex`, `remark-math`                                                                                  | field ISC/Apache/MIT, no LICENSE file in the tarball | Field is the only evidence; upstream repos match                                                                                                                                                                                                                               |
| `typescript` 7.0.2 NOTICE mentions LGPL                                                                                                                                          | Apache-2.0                                           | Microsoft's standard reverse-engineering boilerplate; the listed components are DefinitelyTyped, Unicode, WebGL                                                                                                                                                                |
| Tree-sitter grammars (Editor `tree-sitter-languages`, ~24 grammars, 23 MB lazy JS)                                                                                               | all MIT                                              | `NOTICE` plus `notices/{sql,mdx,astro}.txt` ship with the package. Queries come from the grammar repos or are our own. `discovery/helix.json` is catalog metadata and is not shipped                                                                                           |
| `ghostty-webgpu` and `ghostty-vt.wasm`                                                                                                                                           | MIT                                                  | `THIRD_PARTY_NOTICES.md` covers Ghostty (MIT), the xterm.js stylesheet (MIT) and iTerm2-Color-Schemes (MIT). No third-party library names in the wasm                                                                                                                          |
| Inter, JetBrains Mono (`@fontsource-variable/*`)                                                                                                                                 | OFL-1.1                                              | Fine to ship; needs `OFL.txt` (see attribution above)                                                                                                                                                                                                                          |
| Fontsource / Nerd Fonts downloads (`apps/server/src/fonts/`)                                                                                                                     | mostly OFL, some Apache/UFL                          | Fetched on the user's request for their own use. Subsetting is an OFL "modification", accepted practice for web delivery                                                                                                                                                       |
| Notification sounds                                                                                                                                                              | MIT (t3code)                                         | `web/licenses/t3code-notifications.txt` ships                                                                                                                                                                                                                                  |
| Other spawned LSPs: texlab (GPL-3.0, downloaded), nixd (LGPL-3.0, user-installed), terraform-ls (MPL-2.0, downloaded), jdtls (EPL-2.0, downloaded), plus ~30 MIT/Apache/BSD ones | various                                              | Separate processes over stdio, fetched from upstream by the user's server. No obligation reaches our code. The Kotlin LSP binary comes from JetBrains' CDN; its repo is Apache-2.0, but check the distributed build before relying on that                                     |
| Desktop shell (`electrobun` 2.0.1)                                                                                                                                               | MIT                                                  | Not distributed yet. When a build is handed to anyone it carries CEF (BSD-3 plus Chromium's credits, including LGPL ffmpeg) and a Bun binary (MIT, statically links JavaScriptCore, LGPL-2). Both then need a credits file and the LGPL relink/source offer that Bun documents |
| TUI (`@opentui/*` 0.5.10 including the native zig libs, `bun-ffi-structs`)                                                                                                       | MIT                                                  | Plus the Shiki grammars above                                                                                                                                                                                                                                                  |
| `apps/mac`                                                                                                                                                                       | none                                                 | `Package.swift` has no package dependencies                                                                                                                                                                                                                                    |

**Dev-only, never shipped:**

- lightningcss (MPL-2.0, CSS build).
- `@img/sharp-libvips` 1.2.4 (site build).
- pako (MIT AND Zlib).
- zod-to-ts (no field).

Reference clones under `references/` include:

- FSL: crush.
- GPL-3.0: cspell-dicts, vscode-spell-checker.
- Mixed GPL/AGPL crates: zed.
- No licence at all: agentui, ellie, retronav-ixora, creative-tim-ui-r.

Reading them is fine; copying code from them is not. The only "borrowed" item I found is a hue
value from ellie in `packages/contracts/src/themes/bundled.ts`, which is not copyrightable.

## 2. No LICENSE file

`fregat` (Platform) and `singapore` (Editor) are both **public with no licence**. `ghostty-webgpu`
has an MIT LICENSE tracked, and it is published to npm as `ghostty-webgpu@0.1.0` MIT.

What no licence means: copyright defaults to "all rights reserved". GitHub's terms let anyone view
and fork the repo on GitHub. Nobody may lawfully use, copy, modify or redistribute the code outside
that. It also means:

- Outside contributions arrive without a stated licence.
- The Editor's `publish:packages` script would publish npm packages with no licence field.
- It does not relieve us of the notice duties in §1a for code we took from others.

Options (the choice is the owner's):

- **(a) Keep no licence.** Source-visible, all rights reserved.
- **(b) MIT.** Shortest. No patent clause.
- **(c) Apache-2.0.** Explicit patent grant. Needs a NOTICE file and change notices on modified
  files. This matches the Pierre fork we already carry.
- **(d) MIT OR Apache-2.0 dual.** The Rust-ecosystem convention; users pick.
- **(e) Source-available:** FSL (converts to MIT/Apache after two years, as Charm's crush does),
  BSL or PolyForm. These restrict commercial or competing use.
- **(f) Copyleft (GPL/AGPL/MPL) for our own code.** This is separate from the permissive-only rule
  for dependencies.
- **(g) Make the repos private.**

Platform and Editor can differ, for example a permissive Editor and a more restrictive Platform.
If (b), (c) or (d) is chosen, the copyleft grammar files in §1a are the only shipped items that
would need handling to keep the distribution permissive end to end.

## 3. Dependency weight

**Baseline:**

- **Web:** 57.2 MB of JS in 610 chunks. First load is 18 chunks, 5.48 MB raw / 1.66 MB gzip.
- **Web lazy payload:** mostly grammars (tree-sitter 23 MB, Shiki 8.4 MB plus 1.4 MB of themes)
  and mermaid (~5 MB).
- **Server:** a 4.7 MB bundle, plus 16 MB of wallpapers, plus runtime externals.
- **Install:** 1,201 installed packages across the three repos.

**Two duplicates in the web bundle, no package dropped:**

- The unified/micromark/mdast stack is bundled twice, once from Platform's and once from Editor's
  `node_modules`. Same versions, about 240 KB.
- `@tanstack/hotkeys` is bundled three times (Platform, Editor, ghostty) and `evlog` twice
  (57 KB, two peer hashes).
- A `resolve.dedupe` list in `apps/web/vite.config.ts` removes both. Size S.

**Top drop candidates** (bundle bytes are from the deployed build):

| #   | Package (workspace)                                                       | Call sites                                                                                                                                                            | Weight                                                                                                                                           | Replacement                                                                                                        | Size |
| --- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------ | ---- |
| 1   | `cheerio` (server)                                                        | 1: `fonts/nerd.ts` scrapes nerdfonts.com                                                                                                                              | 21 pkgs, 12.0 MB install, **1,046 KB = 22 % of the server bundle**                                                                               | GitHub releases API JSON for `ryanoasis/nerd-fonts`                                                                | S    |
| 2   | `web-push` (server)                                                       | 2                                                                                                                                                                     | 17 pkgs, 1.5 MB, 219 KB bundled, MPL-2.0                                                                                                         | WebCrypto VAPID + RFC 8291                                                                                         | M    |
| 3   | `sharp` (server external)                                                 | 1                                                                                                                                                                     | 8 pkgs, 38.5 MB, LGPL libvips, per-platform install                                                                                              | `Bun.Image`                                                                                                        | M    |
| 4   | `jszip` (server)                                                          | 1                                                                                                                                                                     | 13 pkgs, 2.7 MB                                                                                                                                  | Nerd Fonts' `.tar.xz` asset plus system `tar` (`Bun.Archive` reads tar.gz only, no zip or xz), or `fflate` (1 pkg) | S    |
| 5   | `typescript-language-service` = `typescript@6.0.3` (server)               | 0 in production. Only `src/lsp/typescript/{session,handlers,shared}` (1,866 lines) imports it, and nothing outside that folder imports those files except their tests | 24.1 MB                                                                                                                                          | Delete it with that code once it is confirmed dead. `runtime.ts` spawns TS 7 or typescript-language-server instead | S    |
| 6   | Shiki `bundledLanguages`/`bundledThemes` (markdown, TUI)                  | 2                                                                                                                                                                     | ~262 grammars, 8.4 MB lazy; 65 themes, 1.4 MB                                                                                                    | Curated map (also the licence fix)                                                                                 | S–M  |
| 7   | `cmdk` (ui)                                                               | 1                                                                                                                                                                     | 26 pkgs; brings Radix Dialog/Portal/Presence, `react-remove-scroll`, `aria-hidden` (~70 KB first-load), a second primitive system beside Base UI | Base UI Dialog plus the existing `useListbox`, or Base UI Combobox                                                 | L    |
| 8   | `react-animated-counter` (web)                                            | 1 (`ticker-number.tsx`)                                                                                                                                               | pulls lodash 4 plus tslib, 9.7 MB install, 12 KB first-load                                                                                      | Own digit roll inside `TickerNumber`                                                                               | S–M  |
| 9   | `minimatch` (contracts)                                                   | 1 (`workspace-search-match.ts`)                                                                                                                                       | 40 KB web first-load plus 52 KB server                                                                                                           | Small glob-to-RegExp in contracts, with parity tests                                                               | M    |
| 10  | `@foresightjs/react` (web)                                                | 2                                                                                                                                                                     | Thin wrapper; `js.foresight` stays                                                                                                               | 20-line hook over `ForesightManager`                                                                               | S    |
| 11  | `@tanstack/pacer` (server)                                                | 1 (`AsyncThrottler`)                                                                                                                                                  | 3 pkgs, 34 KB bundled                                                                                                                            | Inline throttle. The web keeps `react-pacer` (14 sites)                                                            | S    |
| 12  | `remark-cjk-friendly`, `remark-cjk-friendly-gfm-strikethrough` (markdown) | 1                                                                                                                                                                     | 2 direct plus 3 micromark extensions, ~17 KB first-load                                                                                          | Drop, unless CJK emphasis parsing matters                                                                          | S    |
| 13  | `culori` (contracts)                                                      | 1 (`themes/color.ts`)                                                                                                                                                 | 2.2 MB install, 14 KB first-load                                                                                                                 | Inline the OKLCH/sRGB conversions it uses                                                                          | M    |
| 14  | `nanoid` (server)                                                         | 1                                                                                                                                                                     | 1 pkg                                                                                                                                            | `crypto.randomUUID()`                                                                                              | S    |
| 15  | `html-void-elements` (markdown)                                           | 1                                                                                                                                                                     | 1 pkg                                                                                                                                            | Inline the constant list                                                                                           | S    |

Looked at and kept:

- `mermaid`: 104 pkgs, 187 MB install, ~5 MB lazy, zero first-load. See Q4.
- `drizzle-orm`: 27 call sites.
- `jsonc-parser`: comment-preserving `modify`/`applyEdits`, which `Bun.JSONC` does not do.
- `subset-font`: needed by the font pipeline.
- `clsx`: `class-variance-authority` depends on it anyway.
- `react-error-boundary`: AGENTS.md standardises on it.
- `@dnd-kit/*`.
- `@elysia/eden` in `apps/web` is only used by tests and could be a devDependency.

### Side findings (not licence, but they change what gets built)

- **Likely live bug on remote releases.** `jszip` (`fonts/nerd.ts`) and `subset-font`
  (`fonts/fetcher.ts`) are loaded with `createRequire(...)` at runtime, so `bun build` leaves them
  out of the bundle. They are also missing from `RUNTIME_PACKAGES` in
  `apps/server/src/installation/release-files.ts`.
  - On the mesh host this works only because `server/node_modules` is a symlink to the checkout.
  - A release installed from `runtime/package.json` alone (Plan 151, the Mac) should fail both
    Nerd Font install and font subsetting with "Cannot find module".
  - `release-files.test.ts` checks only `--external` and `import.meta.resolve` targets. Not yet
    reproduced on the Mac.
- **The wallpaper comment is wrong.** `bundle-wallpapers.ts` says the artwork is not
  redistributed. It is.

## Where the owner stands (2026-09-26)

Written down so we are aware; nothing here is scheduled because of licences alone.

- **Our own dependencies:** permissive only (MIT, Apache, BSD, ISC and the like) for anything new, and
  as few dependencies as possible. The removals in §3 are [Plan 184](../plans/184-dependency-diet.md).
- **Shiki grammars:** no action yet. The copyleft and unlicensed grammars stay on this list. For
  comparison, VS Code ships only grammars it can redistribute, lists them in its
  `ThirdPartyNotices.txt`, and leaves every other language to extensions the user installs. That
  user-brings-it route is the likely answer if this ever matters.
- **Wallpapers:** kept as they are. Omarchy ships the same images.
- **Project licence (§2):** not decided; the repos stay without a LICENSE for now.
- **Spawned tools and Mermaid:** unchanged.
