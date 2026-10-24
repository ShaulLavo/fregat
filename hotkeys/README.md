<h1 align="center">hotkeys</h1>
<p align="center">Keyboard shortcuts for editors and complex apps.</p>
<p align="center">
  <a href="https://github.com/ShaulLavo/fregat/actions/workflows/workspace-libraries.yml"><img src="https://github.com/ShaulLavo/fregat/actions/workflows/workspace-libraries.yml/badge.svg" alt="Workspace library checks" /></a>
  <a href="https://github.com/ShaulLavo/fregat/blob/main/hotkeys/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="https://github.com/ShaulLavo/fregat/tree/main/hotkeys"><img src="https://img.shields.io/badge/install-source%20%2F%20workspace-blue" alt="Install from source or workspace" /></a>
</p>
<p align="center">
  <a href="packages/hotkeys/docs/concepts.md">Concepts</a> ·
  <a href="packages/hotkeys/docs/keymaps.md">Keymap rules</a> ·
  <a href="packages/hotkeys/docs/api.md">API</a> ·
  <a href="packages/hotkeys/docs/troubleshooting.md">Troubleshooting</a> ·
  <a href="https://fregat.shaulavo.dev/">Used in Fregat</a>
</p>

Bind keys to commands and choose the binding that matches what has focus.
Your app supplies the keymap, including bindings in the style of VS Code, Zed, or another editor.
A DOM-free core handles contexts, chords, and user overrides, with browser and terminal adapters.
Context predicates and chord dispatch follow Zed's model.

Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys) by Tanner Linsley, under the MIT license.

## Register a shortcut

```ts
import { getHotkeyRegistry } from '@fregat/hotkeys'

// Mod is Command on macOS and Control on other platforms
const save = getHotkeyRegistry().register('Mod+S', () => console.log('Save requested'))
save.unregister() // when the view closes
```

## One key, two jobs

`Mod+B` can bold text in the editor and toggle a sidebar elsewhere.
A dispatcher picks the binding from what has focus, and the deepest matching context runs first.

```ts
import { createBrowserDispatcher } from '@fregat/hotkeys'

const keys = createBrowserDispatcher({
  keymap: [
    { keys: 'Mod+B', command: 'sidebar.toggle' },
    { keys: 'Mod+B', command: 'text.bold', context: 'Editor' },
  ],
})
const app = keys.createNode({ commands: { 'sidebar.toggle': () => {} } })
const editor = keys.createNode({
  parent: app,
  context: 'Editor',
  commands: { 'text.bold': () => {} },
})
keys.attachElement(app, document.body)
keys.attachElement(editor, document.getElementById('editor')!)
```

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/assets/key-resolution.dark.svg">
  <img alt="A key press flows through the focus path and context stack, ranks matching bindings, and runs the first handler that does not decline." src="docs/assets/key-resolution.light.svg">
</picture>

## What it gives you

- **Context predicates.** Match expressions such as `Workspace > !Terminal` against a focus tree.
- **User overrides.** Layer user, pack, base, and default bindings. Users can remove a pack's binding or claim a key. See [keymap rules](packages/hotkeys/docs/keymaps.md).
- **Multi-key chords.** Sequences such as `Mod+K Mod+C`, with pending prefixes and replay after a mismatch.
- **Browser and terminal adapters.** Feed DOM keyboard events, terminal escapes, or Kitty keyboard input into the same core.
- **Display and recording.** Format platform-specific shortcut labels and record new shortcuts. [React hooks](packages/react-hotkeys/README.md) tie registrations to a component's lifetime.

## Quick start from source

`@fregat/hotkeys` and `@fregat/react-hotkeys` are not on npm yet.
Use the packages in the Fregat workspace:

```sh
git clone https://github.com/ShaulLavo/fregat.git
cd fregat
bun install --frozen-lockfile
bun run --cwd hotkeys build
```

Import `@fregat/hotkeys` from a workspace consumer. The [development guide](https://github.com/ShaulLavo/fregat/blob/main/docs/development.md#workspace-libraries) explains source builds. Start with [concepts](packages/hotkeys/docs/concepts.md) for the model, or [`@fregat/hotkeys`](packages/hotkeys/README.md) for the simplest registration API.

## Status

Version 0.0.x. The API can change between releases, and npm publishing is planned. Fregat uses this library for its browser and terminal keymaps.
The [lookup benchmark](packages/hotkeys/docs/performance.md) times a 255-binding table. Reproduce it with `bun bench/lookup.ts` from `packages/hotkeys`. Treat its timings as local observations.

## Packages

- [@fregat/hotkeys](packages/hotkeys/README.md): matching, contexts, chords, adapters, display, and recording.
- [@fregat/react-hotkeys](packages/react-hotkeys/README.md): React hooks over the core.

## Contributing and license

Development happens in [Fregat](https://github.com/ShaulLavo/fregat/tree/main/hotkeys).
This repository is a read-only mirror of its `hotkeys/` folder. Submit issues and pull requests to Fregat.
Read the [contribution guide and AI policy](https://github.com/ShaulLavo/fregat/blob/main/CONTRIBUTING.md).

[MIT](LICENSE), with Tanner Linsley's original copyright notice retained.
