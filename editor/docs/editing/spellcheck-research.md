# Spellcheck for painted text: research findings

Research for [E058](https://github.com/ShaulLavo/fregat/blob/main/plans/e058-spellcheck.md), 2026-09-26, at Editor `74e76be` and Platform
`97bfbf2ba`. Probe scripts, corpora and raw output are in `/work/tmp/research2/spellcheck/`
(`bench.mjs <engine>`, `vocab.mjs`, `tok.mjs`, `buildtrie.mjs`). The survey clones are in Platform
`references/` (`cspell`, `cspell-dicts`, `vscode-spell-checker`, `harper`, `codebook`, `zed`).

## What the browser gives us

Nothing we can use.

- The web platform has no spellcheck API. The `spellcheck` attribute turns the user agent's checker
  on for editable content, and that is all it does. Nothing reports which words the checker marked
  or what it suggests. Chromium's `::spelling-error` pseudo-element can restyle native marks, but it
  cannot read them.
- EditContext rules native spellcheck out. The explainer says: "Using the EditContext will make the
  native spellchecking capabilities of the browser unreachable"
  ([w3c/edit-context explainer](https://github.com/w3c/edit-context/blob/gh-pages/explainer.md)). The
  Editor's EditContext host and textarea both set `spellcheck = false`
  ([virtualizedTextViewHelpers.ts](../../packages/editor/src/virtualization/virtualizedTextViewHelpers.ts)
  `createScrollElement`, `createTextareaInput`). Each holds an invisible window of the text, so a
  mark drawn there would not be seen anyway.
- A hidden mirror cannot harvest results. A contenteditable copy of the visible rows would get
  native marks, but only on its own layout. It would have to match ours pixel for pixel (tabs,
  replacements, wrap, proportional fonts), and it would still expose no results to read. Its
  suggestions exist only in the browser's native context menu, which Platform replaces with its
  own `editor.text` menu. Chromium also checks editable text only after focus or typing. Rejected.
- Electron exposes `webFrame.isWordMisspelled` and `getWordSuggestions`. Platform ships on the mesh
  as a web app, and its desktop shell is Electrobun on CEF, which has no such API.
- Mobile keyboards autocorrect through the input element's own text. That is a separate channel,
  covered by Plan 171's prose input options (row 19), and it draws no marks.

VS Code and CodeMirror 6 disable native spellcheck too (`nativeEditContext.ts:108`,
`codemirror-view/src/editorview.ts:525`). CodeMirror users opt back in through
`contentAttributes`. That works only because CodeMirror's text is real contenteditable DOM.

## Engines measured

All runs used Node 26 (V8) on this machine, one process per engine, with `--expose-gc`.

Corpora:

- **Composer:** a 60-word chat message with three typos.
- **10k-line markdown:** the first 10,000 lines of Platform `plans/*.md` (989 KB). The prose
  tokenizer skips fenced code, inline code, link targets, URLs, paths, camelCase and acronyms, which
  leaves 78,955 words, 6,274 of them distinct.
- **Suggestion quality:** Norvig's Birkbeck-derived `spell-testset1` and `spell-testset2`. A pair
  counts only if the engine accepts the target word and flags the misspelling, about 630 pairs per
  engine.

| Engine (licence)                                           | Code + data, gzip                     | Init   | Memory     | Check all 79k words | Suggest median / p95  | Top-1 / top-5 |
| ---------------------------------------------------------- | ------------------------------------- | ------ | ---------- | ------------------- | --------------------- | ------------- |
| cspell-trie-lib + `@cspell/dict-en_us` (MIT, SCOWL data)   | 34 KB + 298 KB                        | 68 ms  | 4 MB heap  | 17–21 ms            | 4.8 / 7.9 ms          | 72.8 / 89.3   |
| same, SCOWL-60 tier breaks near-ties                       | + tier data                           | —      | —          | —                   | 4.2 / 6.6 ms          | 75.8 / 91.1   |
| same, word frequency breaks near-ties                      | + 630 KB frequency                    | —      | —          | —                   | 4.1 / 6.2 ms          | 77.6 / 93.5   |
| nspell + `dictionary-en` (MIT; SCOWL-60 hunspell)          | 4 KB + 192 KB                         | 78 ms  | 12 MB heap | 15 ms               | 1.3 / 39 ms, max 97   | 67.6 / 81.3   |
| typo-js (BSD-3)                                            | 3 KB + 192 KB                         | 127 ms | 17 MB heap | 20 ms               | 430 / 1,087 ms        | 67.3 / 88.1   |
| spellchecker-wasm, SymSpell (MIT; 82k-word frequency list) | 79 KB wasm + 628 KB                   | 560 ms | 105 MB RSS | 137 ms              | 0.02 / 0.08 ms        | 77.5 / 90.2   |
| Harper `harper.js` 2.10, spelling rule only (Apache-2.0)   | 8.1 MB wasm                           | 486 ms | 284 MB RSS | 6.1 s (markdown)    | 0.6 / 0.7 ms          | 76.9 / 89.6   |
| Own: word `Set` + Norvig edits + frequency, no deps        | 1 KB + 512 KB list + 630 KB frequency | 102 ms | 20 MB heap | 8 ms                | 0.12 / 84 ms, max 161 | 77.6 / 89.3   |

Notes on the table:

- Top-1/top-5 are conditional suggestion-ranking percentages over each engine's eligible pairs,
  as defined above. Eligibility differs between engines. These historical rows did not separately
  report target coverage or accepted typos, so they cannot establish overall detection accuracy.
  The current `packages/spellcheck/bench/engine.ts` reports all three counts explicitly.
- `hunspell-asm` would not load under Node 26 or Bun: its 2020 Emscripten glue fails. It is also
  excluded on licence, because it compiles Hunspell (MPL-1.1/GPL-2/LGPL-2.1).
- Harper lints text rather than checking words. Its 6.1 s is the whole 1 MB file as markdown with
  every rule except `SpellCheck` turned off. A 40-line paragraph takes 6.6 ms. It is English only,
  and the provenance of its compiled word list is unstated.
- SymSpell's list has no `a` or `I` and few inflections, so it flagged `a` 2,332 times.
- Tokenizing costs more than checking: 32 ms for the whole 10k-line file, 0.2 ms for a 60-line
  viewport. Checking the 6,274 distinct words takes 2 ms, so a verdict cache per word removes
  nearly all repeated work.

### Vocabulary

On the same 79k words, US English flags 343 distinct words (1,185 occurrences, 1.5%). Most are
engineering vocabulary (`backend`, `repo`, `worktree`, `config`) or product names.

| Dictionaries                                             | Distinct flagged | Occurrences |
| -------------------------------------------------------- | ---------------- | ----------- |
| en-US                                                    | 343              | 1,185       |
| en-US + `@cspell/dict-software-terms` (MIT, 3,247 terms) | 182              | 627         |
| en-GB (SCOWL-60) + software terms                        | 339              | 1,094       |
| en-US + en-GB + software terms                           | 166              | 553         |

The repository writes both spellings: `behavior` 177 times and `behaviour` 94 times in plans and
web source, and `colour` 105 times. A US-only checker flags `behaviour` 42 times in this corpus
alone.

SCOWL's en_GB hunspell pair (`dictionary-en-gb`, the SCOWL licence) expands to 123,402 words with
`hunspell-reader` (MIT). `cspell-trie-lib` builds it into a 153 KB gzip trie in 365 ms. A second
dialect is a build step, not a new dependency.

## Licences

This historical package survey found permissive candidates for English, Dutch and Russian,
unclear French provenance, and AGPL Hebrew candidates. It is a sample of the packages examined,
not an exhaustive or current licensing inventory. Review the exact source, version, license and
attribution of every dictionary before adding it; an engine's license does not cover its data.

| Language                             | Permissive source surveyed                                                                | Copyleft source surveyed                              |
| ------------------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| English                              | SCOWL (en_US, en_GB, en_CA, en_AU): Atkinson's notice plus Ispell BSD and WordNet notices | `@cspell/dict-en-gb` is LGPL-3.0 (another source)     |
| Dutch                                | OpenTaal, BSD-3 or CC-BY-3.0 (`dictionary-nl`)                                            | —                                                     |
| Russian                              | `dictionary-ru`, BSD-3                                                                    | `@cspell/dict-ru_ru` is GPL-3.0                       |
| French                               | `@cspell/dict-fr-fr` says MIT, but its source (Dicollecte) is MPL-2.0                     | `dictionary-fr` is MPL-2.0                            |
| German, Spanish, Italian, Portuguese | —                                                                                         | GPL, LGPL or MPL in the surveyed packages             |
| Hebrew                               | —                                                                                         | hspell, AGPL-3.0 (`dictionary-he`, `@cspell/dict-he`) |

`@cspell/dict-en_us` declares MIT. Its README says the words "come directly from SCOWL and is thus
under the same copyright of SCOWL", so a copy we ship carries the SCOWL notice. The VS Code cSpell
extension as a whole is GPL-3.0-or-later; `cspell` and `cspell-trie-lib` are MIT.

## How other editors do it

- **Zed** has no spellcheck in core. It comes from language-server extensions (`harper`,
  `codebook`, `cspell`, `typos`, `ltex`) as diagnostics with a wavy underline, with suggestions and
  "add to dictionary" as code actions. Codebook (MIT) checks only tree-sitter `comment` and
  `string` captures, plus identifiers where they are defined
  (`codebook/crates/codebook/src/queries/typescript.scm`). It splits camelCase and snake_case, and
  skips URLs, hex, email, paths and UUIDs by regex (`regexes.rs:20-48`).
- **Harper's language server** checks only comment nodes in code. It adds the file's own identifiers
  to the accepted words (`harper-ls/src/backend.rs:345-351`), and keeps user, workspace and per-file
  dictionaries as plain text files.
- **VS Code** has no core checker. cSpell is a client with a language server:
  - It re-validates the whole document after a 50 ms throttle.
  - Issues are diagnostics, and suggestions are quick fixes.
  - It checks the whole document, not just comments, and splits camelCase. Default ignores cover
    URLs, email, UUIDs, hex and hashes; the minimum word length is 4.
  - It hides the word being typed until a pause (`hideIssuesWhileTyping`,
    `revealIssuesAfterDelayMS` 1500).
  - Its guards: `checkLimit` of 500 KB, lines over 20,000 characters skipped, 100 problems per file.
  - Words live in settings (`cSpell.words`, user and workspace) or in dictionary files.
- **CodeMirror 6** has no official package. The community ones are typo-js decorations with a
  `.cm-spell-error` class. Harper's Obsidian plugin runs `WorkerLinter` and draws `Decoration.mark`
  ranges, with suggestions and "Add to dictionary" in a tooltip. Obsidian itself relies on
  Electron's native checker.
- **Neovim** marks tree-sitter nodes with `@spell` and `@nospell` captures, so its built-in checker
  reads only comments, strings and prose. E058 takes this model.
