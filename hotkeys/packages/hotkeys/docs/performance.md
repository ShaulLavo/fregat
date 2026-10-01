# performance

`bun bench/lookup.ts` from this package, on an editor-shaped 255-binding table (Bun 1.4, Linux). each row is the per-call range over three rounds of two runs, timed per keyboard event with results kept in a sink. the Editor rows run the singapore editor's own trie on the same table and events when its checkout is linked at `packages/editor-core`

| per keyboard event                                             | time           |
| -------------------------------------------------------------- | -------------- |
| `keyInputFromKeyboardEvent` + `trieStep`, plain `q` (unbound)  | 0.030–0.065 µs |
| Editor `trieStep(event)`, plain `q`                            | 0.025–0.032 µs |
| `keyInputFromKeyboardEvent` + `trieStep`, `Control+E` (bound)  | 0.039–0.047 µs |
| Editor `trieStep(event)`, `Control+E`                          | 0.021–0.022 µs |
| `trieStep` on a prebuilt `KeyInput`, plain `q`                 | 0.008–0.023 µs |
| `dispatcher.handleKey(event)`, plain `q`                       | 0.088–0.099 µs |
| `dispatcher.handleKey(event)`, `Control+E`, context resolution | 0.17–0.19 µs   |

per event this costs 1.0–2.6× the Editor trie for an unbound key and about 2× for a bound one; building the `KeyInput` is most of the difference. both lookups stay under 0.1 µs, far below a frame

`compileKeymap` costs 0.68 / 1.15 / 0.84 µs per binding at 255 / 2,550 / 25,500 bindings, so construction is linear in the binding count. for comparison, a linear `matchesKeyboardEvent` scan over the Editor's 255 bindings costs about 83 µs per key
