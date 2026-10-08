<h1 align="center">hotkeys</h1>
<p align="center">Keyboard shortcuts for editors and complex apps.</p>
<p align="center">
  <a href="https://github.com/ShaulLavo/fregat/actions/workflows/workspace-libraries.yml"><img src="https://github.com/ShaulLavo/fregat/actions/workflows/workspace-libraries.yml/badge.svg" alt="Workspace library checks" /></a>
  <a href="https://github.com/ShaulLavo/fregat/blob/main/hotkeys/LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue" alt="MIT license" /></a>
  <a href="https://github.com/ShaulLavo/fregat/tree/main/hotkeys"><img src="https://img.shields.io/badge/install-source%20%2F%20workspace-blue" alt="Install from source or workspace" /></a>
</p>
<p align="center">
  <a href="https://shaulavo.dev/fregat/">Used in Fregat</a> ·
  <a href="https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/README.md">API and examples</a> ·
  <a href="https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/keymaps.md">Keymap rules</a> ·
  <a href="https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/performance.md">Benchmarks</a>
</p>

Bind keys to commands and choose the binding that matches what has focus.
Your app supplies the keymap, including bindings in the style of VS Code, Zed, or another editor.
A DOM-free core handles contexts, chords, and user overrides, with browser and terminal adapters.
Context predicates and chord dispatch follow Zed's model.

Forked from [TanStack Hotkeys](https://github.com/TanStack/hotkeys) by Tanner Linsley, under the MIT license.

## One key, two jobs

`Mod+B` can bold text in the editor and toggle a sidebar elsewhere.
`Mod` means Command on macOS and Control on other platforms.

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

Replace the empty handlers with your app's actions.
The deepest matching focus context wins. [Keymap rules](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/keymaps.md) explain predicates, ranking, and unbinding.

## What it gives you

- **Context predicates.** Match expressions such as `Workspace > !Terminal` against a focus tree. [Context rules](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/keymaps.md) define the operators.
- **User overrides.** Layer user, pack, base, and default bindings. Users can remove a pack's binding or claim a key. Read the [source-ranking rules](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/keymaps.md).
- **Multi-key chords.** A trie handles sequences such as `Mod+K Mod+C`, pending prefixes, and replay after a mismatch. See the [core API](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/README.md).
- **Browser and terminal adapters.** Feed DOM keyboard events, terminal escapes, or Kitty keyboard input into the same core. See the [adapter examples](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/README.md).
- **Display and recording.** Format platform-specific shortcut labels and record new shortcuts from input. [React hooks](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/react-hotkeys/README.md) manage registrations for a component's lifetime.

## Quick start from source

`@fregat/hotkeys` and `@fregat/react-hotkeys` are not on npm yet.
Use the packages in the Fregat workspace:

```sh
git clone https://github.com/ShaulLavo/fregat.git
cd fregat
bun install --frozen-lockfile
bun run --cwd hotkeys build
```

Import `@fregat/hotkeys` from a workspace consumer.
The [development guide](https://github.com/ShaulLavo/fregat/blob/main/docs/development.md#workspace-libraries) explains source builds.

## Proof and limits

Fregat uses this library for its browser and terminal keymaps.
The [lookup benchmark](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/docs/performance.md) records trie lookup, dispatcher context resolution, and keymap construction on an editor-shaped binding table.
Run `bun bench/lookup.ts` from `hotkeys/packages/hotkeys` to reproduce it.
The published benchmark has limited machine metadata. Treat its timings as local observations until a dated, fully specified rerun lands.

## Packages

| Package                                                                                                         | Purpose                                                           |
| --------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [@fregat/hotkeys](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/hotkeys/README.md)             | Core matching, contexts, chords, adapters, display, and recording |
| [@fregat/react-hotkeys](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/packages/react-hotkeys/README.md) | React hooks over the core                                         |

## Planned work

| Work           | Status                                 | Plan                                                                                                                                             |
| -------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| npm publishing | Planned. Publishing setup is deferred. | [Packages as products](https://github.com/ShaulLavo/fregat/blob/main/plans/336-packages-as-products.md#track-n-npm-publishing-last-with-track-e) |

The [Fregat roadmap](https://github.com/ShaulLavo/fregat/blob/main/PLAN.md) owns scheduling.

## Contributing and license

Development happens in [Fregat](https://github.com/ShaulLavo/fregat/tree/main/hotkeys).
This repository is a read-only mirror of its `hotkeys/` folder. Submit issues and pull requests to Fregat.
Read the [contribution guide and AI policy](https://github.com/ShaulLavo/fregat/blob/main/CONTRIBUTING.md).

[MIT](https://github.com/ShaulLavo/fregat/blob/main/hotkeys/LICENSE), with Tanner Linsley's original copyright notice retained.
