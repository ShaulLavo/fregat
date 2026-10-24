# performance

`bun bench/lookup.ts` from this package, on an editor-shaped 255-binding table (Bun 1.4, Linux). each row is the per-call range over three rounds of two runs, timed per keyboard event with results kept in a sink.

| per keyboard event                                             | time           |
| -------------------------------------------------------------- | -------------- |
| `keyInputFromKeyboardEvent` + `trieStep`, plain `q` (unbound)  | 0.030–0.065 µs |
| `keyInputFromKeyboardEvent` + `trieStep`, `Control+E` (bound)  | 0.039–0.047 µs |
| `trieStep` on a prebuilt `KeyInput`, plain `q`                 | 0.008–0.023 µs |
| `dispatcher.handleKey(event)`, plain `q`                       | 0.088–0.099 µs |
| `dispatcher.handleKey(event)`, `Control+E`, context resolution | 0.17–0.19 µs   |

every lookup stays under 0.2 µs per event, far below a frame; building the `KeyInput` from the event is most of the gap between the first and third rows

`compileKeymap` costs 0.68 / 1.15 / 0.84 µs per binding at 255 / 2,550 / 25,500 bindings, so construction is linear in the binding count. for comparison, a linear `matchesKeyboardEvent` scan over the same 255 bindings costs about 83 µs per key
