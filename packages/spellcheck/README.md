# @singapore-editor/spellcheck

English spellcheck engine for text the editor paints itself. A worker holds the dictionary; the
page creates one `SpellcheckService` and shares it between editors.

US and British spellings are both accepted, plus software vocabulary. The dictionary is built from
SCOWL and cspell's word lists by `bun run build:dictionaries`; see `THIRD_PARTY_NOTICES`.

## Usage

In an editor: one service per page, one plugin per editor.

```ts
import { Editor } from '@singapore-editor/core/editor'
import {
  createSpellcheckPlugin,
  EDITOR_SPELLCHECK_FEATURE,
  SpellcheckService,
} from '@singapore-editor/spellcheck'

const service = new SpellcheckService()
const editor = new Editor(element, { plugins: [createSpellcheckPlugin({ service })] })
const spelling = editor.getFeature(EDITOR_SPELLCHECK_FEATURE)
const issue = spelling?.issueAt(offset) // { start, end, word } or null
const suggestions = await spelling?.suggestions(offset)
spelling?.replace(offset, suggestions[0]) // one undoable edit
```

Plain text and Markdown prose are checked; `scope: 'proseAndCode'` adds comments and strings in
code. Markdown code, link targets and labels, and anything an inline replacement stands in for are
skipped. The word being typed is not marked until the caret leaves it.

On its own:

```ts
import { SpellcheckService, tokenizeSpellWords } from '@singapore-editor/spellcheck'

const spellcheck = new SpellcheckService()
const text = 'the list settles befor the cursor'
const words = tokenizeSpellWords(text)
const misspelled = new Set(await spellcheck.check(words.map((word) => word.word)))
const marks = words.filter((word) => misspelled.has(word.word))
const suggestions = await spellcheck.suggest('befor') // ['before', …]
spellcheck.setAcceptedWords(['fregat'])
spellcheck.dispose()
```

## Exports

- `createSpellcheckPlugin({ service, scope })` and `EDITOR_SPELLCHECK_FEATURE`: `issueAt(offset)`,
  `suggestions(offset, limit)`, `replace(offset, word)` and `setAcceptedWords(words)`.
- `SpellcheckService`: `check(words)`, `suggest(word, limit)`, `setAcceptedWords(words)` and
  `dispose()`. The worker starts on the first request.
- `tokenizeSpellWords(text, { mode, excluded })`: the words to check, with offsets. It skips
  acronyms, camelCase, words with digits or `_`, runs containing letters outside ASCII, URLs, email addresses, paths and
  the `excluded` ranges. `mode: 'code'` splits camelCase and snake_case instead.

## Language and work limits

The bundled dictionary checks English. There is no natural-language detection. Prose candidates
contain ASCII letters and internal straight or typographic apostrophes. `hola mundo` is submitted
to the English checker; `שלום`, `привет` and `café` are skipped. This also skips accented words
that occur in English. Programming-language selection controls which editor regions are prose.

Whitespace-delimited chunks longer than 256 UTF-16 code units are skipped before structured-text
classification. The editor skips prose lines and code regions longer than 16,384 code units before
reading them. This bounds synchronous work on generated text and large pastes. Short surrounding
chunks remain checkable through `tokenizeSpellWords`.

Worker setup and posting failures reject `check` and `suggest`, settle every outstanding request,
and terminate that worker. A later service request creates a fresh worker and resends accepted
words. An editor that sees a check failure stops requesting checks for its lifetime so typing
cannot start a retry loop. Failed accepted-word synchronization retains the local list for the
next worker and notifies listeners. Disposal rejects outstanding requests and prevents restart.

## Language-support follow-up

Add an explicit `languages` selection separate from syntax language and default it to English.
Start with manually selected dictionaries; mixed-language documents accept a word found in any
selected dictionary, and merge/deduplicate suggestions in configured language order. Automatic
language detection is outside this scope.

Load dictionaries lazily in the shared service from a language manifest. Each entry must record
its source, version, attribution and verified permissive data license. Review these for each
selected dictionary; the engine license does not cover dictionary data. Bundle English only by
default and load other selected assets on demand.

Change tokenization with dictionary selection: Unicode letters/marks, language-specific word
segmentation, apostrophe policy and NFC normalization must preserve original UTF-16 offsets.
Keep script selection explicit so mixed scripts are checked only when a selected dictionary
supports them. Define case folding per dictionary rather than globally stripping accents.

Treat a language change as a new dictionary generation. Clear controller verdicts, pending-word
sets, cached line tokenization and painted issues; ignore replies from the previous generation.
Only publish the new generation once all selected dictionaries load. A load failure leaves the
previous complete selection active and reports the failed selection to the host. Accepted words
remain user-owned and are synchronized into the new generation.

## Benchmark interpretation

`bun run bench:engine` evaluates the common Norvig spell-testset1/2 pairs. It reports total pairs,
target-word coverage, and misspellings accepted despite a covered target separately. Suggestion
ranking runs only on pairs where the dictionary accepts the target and rejects the typo.
`eligibleRankingPairs` is the denominator of `eligibleTop1Percent` and `eligibleTop5Percent`.
Compare engines using the same pair set and report coverage and missed typos alongside ranking.
These conditional ranking percentages do not measure overall typo-detection accuracy.
