# api

every export of `@fregat/hotkeys`, grouped by job. the source of truth is [`src/index.ts`](../src/index.ts). `@fregat/react-hotkeys` re-exports all of it

## register shortcuts

| export                                              | does                                                                                                       |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `getHotkeyRegistry(doc?)`                           | the shared registry for a document                                                                         |
| `createHotkeyRegistry(...)`                         | a registry you own                                                                                         |
| `HotkeyRegistry.register(keys, callback, options?)` | registers a key or a chord and returns a handle with `unregister`, `setOptions`, and a settable `callback` |
| `HotkeyRegistry.registrations`                      | a store of live registrations, for palettes and devtools                                                   |
| `HotkeyRegistry.trigger(id)`                        | runs a callback without a key                                                                              |
| `HotkeyRegistry.dispatcher`                         | the browser dispatcher underneath                                                                          |
| `findHotkeyConflicts(candidate, options?)`          | lists live registrations that a new shortcut would collide with, for settings screens                      |

registration options: `conflictBehavior` (`'warn'` by default), `enabled`, `eventType`, `ignoreInputs`, `platform`, `preventDefault`, `requireReset`, `stopPropagation`, `target`, `meta`

## route keys by focus

| export                                           | does                                                    |
| ------------------------------------------------ | ------------------------------------------------------- |
| `createBrowserDispatcher(options)`               | a dispatcher with DOM listeners and `attachElement`     |
| `createDispatcher(options)`                      | the same engine with no DOM                             |
| `Dispatcher.createNode(options)`                 | a focus node with a context and command handlers        |
| `Dispatcher.handleKey(input, source)`            | offers a key and returns whether a binding took it      |
| `Dispatcher.dispatchCommand(command, args?)`     | runs a command along the focus path with no key         |
| `Dispatcher.setKeymap(entries)`                  | replaces the keymap                                     |
| `Dispatcher.contextStack()`                      | the contexts from the outermost node to the focused one |
| `Dispatcher.pending()`                           | the pending chord, or `null`                            |
| `BrowserDispatcher.attachElement(node, element)` | ties a node to an element                               |
| `BrowserDispatcher.claimKeybinding(event)`       | offers a forwarded event before DOM dispatch            |
| `compileKeymap(entries, platform)`               | compiles entries for lookup                             |
| `bindingsForInput(keymap, inputs, stack)`        | what a key sequence runs under a stack                  |
| `parseKeyContext`, `createKeyContext`            | build a context from shorthand or an object             |
| `parseContextPredicate`, `evaluatePredicate`     | the predicate language behind `context`                 |

dispatcher options: `keymap`, `platform`, `timeoutMs`, `replay`, `acceptsTextInput`, `isAvailable`, `currentFocus`, `onPendingChange`, `onSequence`, `onCaptureChange`. the browser dispatcher adds `root`, `capture`, and `beforeKey`

## terminals

| export                           | does                                          |
| -------------------------------- | --------------------------------------------- |
| `keyInputFromTerminalKey(event)` | turns a parsed terminal key into a `KeyInput` |
| `terminalKeyEffects`             | key effects for the terminal event shape      |
| `TerminalKeyLike`                | the accepted event shape                      |

## parse, match, and format

| export                                                     | does                                      |
| ---------------------------------------------------------- | ----------------------------------------- |
| `parseHotkey`, `normalizeHotkey`, `parseKeyInput`          | read and normalize hotkey strings         |
| `validateHotkey`, `assertValidHotkey`, `checkHotkey`       | check a hotkey string                     |
| `matchesKeyboardEvent`, `matchesKeyInput`                  | test an event against a hotkey            |
| `createHotkeyHandler`, `createMultiHotkeyHandler`          | wrap callbacks that match                 |
| `formatForDisplay(hotkey, options?)`                       | a platform label such as `⌘S` or `Ctrl+S` |
| `formatHotkey`, `formatHotkeySequence`, `formatWithLabels` | lower-level formatters                    |
| `detectPlatform()`, `resolveModifier()`                    | resolve `Mod` for a platform              |

## record shortcuts

| export                                    | does                                                     |
| ----------------------------------------- | -------------------------------------------------------- |
| `HotkeyRecorder`                          | records one shortcut from input                          |
| `HotkeySequenceRecorder`                  | records a chord                                          |
| `KeyStateTracker`, `getKeyStateTracker()` | tracks held keys                                         |
| `matchesHeldModifiers(hotkey, heldKeys)`  | whether the held modifiers should reveal a shortcut hint |

## low level

`createChordRuntime`, `buildKeymapTrie`, `trieStep`, `createKeymapRuntime`, `attachKeyListeners`, `keyInputFromKeyboardEvent`, `createKeyInput`. use these to build a new adapter. most apps never need them

## react

`@fregat/react-hotkeys` adds `HotkeysProvider`, `useHotkey`, `useHotkeys`, `useHotkeySequence`, `useHotkeySequences`, `useHotkeyRecorder`, `useHotkeySequenceRecorder`, `useHotkeyRegistrations`, `useHeldKeys`, `useHeldKeyCodes`, `useKeyHold`, and `useHotkeyHint`. it needs React 18 or newer

`useHotkey(keys, callback, options?)` registers for the component's lifetime and re-syncs the callback and options on every render, so the callback never sees stale state. `options` is the registration options above, except `target` can also be a React ref. `enabled: false` keeps the registration listed and stops it firing

```tsx
useHotkey('Escape', onClose, { enabled: isOpen })
useHotkey('Mod+S', save, { target: editorRef })
```

`HotkeysProvider` takes `defaultOptions` with the keys `hotkey`, `hotkeySequence`, `hotkeyRecorder`, and `hotkeySequenceRecorder`. each holds defaults for the matching hook. the react hooks use the registry, so they do not have focus contexts. for those, use `registry.dispatcher` or a dispatcher from `@fregat/hotkeys`
