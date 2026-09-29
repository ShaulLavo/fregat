# @fregat/hotkeys

Keyboard shortcuts for editors: key parsing and display, a chord trie, and context resolution
modelled on Zed. The core never touches the DOM; adapters turn browser and terminal input into
its key events. The library ships no keymap.

| Package                                           | Contents                                                  |
| ------------------------------------------------- | --------------------------------------------------------- |
| [`@fregat/hotkeys`](packages/hotkeys)             | Core: parsing, matching, formatting, recorders, key state |
| [`@fregat/react-hotkeys`](packages/react-hotkeys) | React hooks over the core                                 |

## Origin

This is a fork of [TanStack Hotkeys](https://github.com/TanStack/hotkeys) (MIT, © 2026 Tanner
Linsley), imported from upstream commit `536da97c6a91080cdecf13d74103dcd4a3d3529f`
(`@tanstack/hotkeys` 0.10.1, `@tanstack/react-hotkeys` 0.12.1). The Angular, Lit, Preact,
Solid, Svelte and Vue adapters and the devtools packages were left behind. Upstream changes are
not merged; `references/tanstack-hotkeys` in the Fregat checkout tracks upstream for comparison.
The original licence is in [LICENSE](LICENSE) and in each package.

## Development

```sh
bun run --filter '@fregat/*' test
bun run --filter '@fregat/*' typecheck
bun run --cwd hotkeys/packages/hotkeys build
bun hotkeys/packages/hotkeys/bench/lookup.ts
```
