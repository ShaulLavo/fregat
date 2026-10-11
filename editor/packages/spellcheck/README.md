# @singapore-editor/spellcheck

Worker-based English spellchecking for the Singapore editor and standalone text.

Part of [Singapore](https://singapore.shaulavo.dev/). A code editor for the browser that keeps every version.

## Install

```sh
npm install @singapore-editor/spellcheck
```

## Usage

```ts
import { SpellcheckService, tokenizeSpellWords } from '@singapore-editor/spellcheck'

const service = new SpellcheckService()
const words = tokenizeSpellWords('the list settles befor the cursor')
console.log(await service.check(words.map((word) => word.word)))
console.log(await service.suggest('befor'))
service.dispose()
```

## API highlights

- `SpellcheckService.check()` finds misspelled words.
- `suggest()` returns corrections.
- `createSpellcheckPlugin()` marks spelling issues in an editor.

[Generated API reference](https://singapore.shaulavo.dev/docs/reference/api/spellcheck/overview/)

## In the Singapore family

You can use this package on its own. `@singapore-editor/core` owns editor views; optional packages add syntax, search, gutters, and language features.
Use a bundler that serves the package worker and data assets. See the [hosting guide](https://singapore.shaulavo.dev/docs/guides/bundling/).

[Singapore README](https://github.com/ShaulLavo/fregat/blob/main/editor/README.md) · [Documentation](https://singapore.shaulavo.dev/docs/start-here/introduction/)

## License

MIT. [License](https://github.com/ShaulLavo/fregat/blob/main/editor/LICENSE)
Dictionary licenses are listed in [THIRD_PARTY_NOTICES](https://github.com/ShaulLavo/fregat/blob/main/editor/packages/spellcheck/THIRD_PARTY_NOTICES).
