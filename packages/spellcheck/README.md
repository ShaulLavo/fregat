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
  acronyms, camelCase, words with digits or `_`, non-English words, URLs, email addresses, paths and
  the `excluded` ranges. `mode: 'code'` splits camelCase and snake_case instead.
