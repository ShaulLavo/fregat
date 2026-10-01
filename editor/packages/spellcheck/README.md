# @singapore-editor/spellcheck

english spellcheck for text the editor paints itself. a worker holds the dictionary, and one `SpellcheckService` per page serves every editor

it accepts us and british spellings plus common software words. plain text and markdown prose get checked by default. the word you're typing stays unmarked until the caret leaves it

## try it

```sh
npm install @singapore-editor/core @singapore-editor/spellcheck
```

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
if (spelling && issue) {
  const [best] = await spelling.suggestions(offset)
  if (best) spelling.replace(offset, best) // one undoable edit
}
```

`scope: 'proseAndCode'` also checks comments and strings in code

without an editor

```ts
import { SpellcheckService, tokenizeSpellWords } from '@singapore-editor/spellcheck'

const spellcheck = new SpellcheckService()
const words = tokenizeSpellWords('the list settles befor the cursor')
const misspelled = await spellcheck.check(words.map((w) => w.word)) // ['befor']
const suggestions = await spellcheck.suggest('befor') // includes 'before'
spellcheck.setAcceptedWords(['fregat'])
spellcheck.dispose()
```

`tokenizeSpellWords` returns words with their offsets. it skips acronyms, camelCase, urls, paths and anything else shaped like an identifier. `mode: 'code'` splits camelCase and snake_case into words

## more

- [limits, failures and benchmarks](docs/engine.md): which words get checked, how worker failures recover, adding languages, reading `bench:engine`
- `bun run build:dictionaries` rebuilds the dictionary from scowl and cspell word lists

dictionary sources and the cspell-trie-lib license are in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES)
