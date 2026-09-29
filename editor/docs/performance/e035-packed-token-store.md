# E035 packed token store

E035 is complete on 2026-09-17. The document's syntax tokens are one immutable
[`EditorTokenStore`](../../packages/editor/src/syntax/tokenStore.ts): packed offsets and palette
ids, sorted by start. The highlighter contract, the syntax controller, the view, the view snapshot,
the minimap, sticky scroll, diff, decode and rich-text copy read it; nothing unpacks a document.
On 100,000 lines (500,000 tokens) the token work one keystroke causes on the main thread went from
155 ms to 0.004 ms, and it no longer grows with the document.

Inspected baseline: `c2447cf` on `main`. Branch `e035-packed-token-store`.

## The premise was half the cost

The plan named `unpackEditorTokens` as the last per-edit cost that scales with the document. Step 1
measured the whole path a keystroke causes, one stage at a time
(`keystroke-baseline.ts` in [`e035-evidence.tar.gz`](e035-evidence.tar.gz), Bun 1.3.14, median of 8
after 4 warmups):

| Stage at `c2447cf`                                   | 500k tokens | 2.5M tokens |
| ---------------------------------------------------- | ----------: | ----------: |
| project tokens through the edit (lazy `Proxy` array) |    0.043 ms |    0.041 ms |
| splice the re-tokenized line into the packed arrays  |     1.66 ms |     7.89 ms |
| unpack the answer into objects                       |     4.15 ms |     37.6 ms |
| view compares the answer with what it shows          |     65.6 ms |      449 ms |
| minimap diffs the answer against what it sent        |     74.5 ms |      512 ms |
| total                                                |      155 ms |    1,046 ms |

Two findings the plan did not have:

- The projection was already lazy. It cost microseconds because it wrapped the old array in a
  `Proxy` and shifted the suffix on read. A packed store that copied its arrays per edit would have
  made the keystroke path slower, not faster: 1.5 ms and 7.6 ms at the two sizes.
- That `Proxy` is what made the rest expensive. When the highlighter's answer matched the
  projection, which is the ordinary case while typing inside an identifier, the view's
  `editorTokensEqual` and the minimap's `changedTokenRange` both walked every token through it.
  The unpack was 3% of the cost; the two walks were 90%.

## What changed

- **The store is persistent, not copied.** A store is a short list of segments, each a window onto
  shared typed arrays plus a shift. `replaceRange` builds the segments before the edit, the new
  tokens, and the segments after it with the length change added to their shift. Projecting through
  an edit and splicing a highlighter's lines are the same operation. Two small neighbours are
  copied into one, so typing in one place stays at three segments; past 128 segments the cheapest
  adjacent pair is merged, so no edit ever pays for a flat copy. A full flatten at the cap was
  measured first and cost 9 ms once per 64 distant edits at 2.5M tokens; the pair merge peaks at
  0.24 ms.
- **Provenance replaces identity.** Every store has a `revision`; a projection records
  `derivedFrom: { revision, keepsLiveRanges }`. `tokenProjectionLiveRangeStatus` compares
  revisions where it compared array identity in a `WeakMap`. A highlighter answer carries no
  origin, as a fresh array carried none, so `adoptTokens` takes the same branches as before.
- **Comparison skips what is shared.** `equals`, `stylesEqual` and `changedRangeTo` walk two stores
  together and jump over any run where both read the same arrays at the same index with the same
  shift. The editor adopts the highlighter's store, so a projection and the next answer share
  everything but the edited line.
- **Always sorted.** Input from a host (`Editor.setTokens`, `EditorDocument.tokens`, a syntax
  provider's `tokens`) is converted once by `toEditorTokenStore` and stable-sorted if needed. That
  removed the view's unindexed path: `rebuildTokenRenderIndex`, which walked every token into a
  render entry, is gone with its three fields, and the row painter bisects the store. Render style
  and style key are cached per palette style object, which also replaced the per-projection
  `TokenStyleSource`. This is the second full index the plan's stop condition asked about; it was
  deleted rather than rebuilt.
- **Overlapping input.** Both producers emit non-overlapping ascending tokens. A store whose ends
  do not grow with its starts, which only hand-built input can be, is kept as one flat segment with
  a lazily built running-maximum array, and an edit copies it. That cost is bounded by the host's
  input.
- **Range answers.** `mergeSyntaxRangeTokens` was a concat, a sort and an index rebuild; it is
  `replaceOffsetRange`, which drops every token reaching into the range, as the old filter did.
- **Consumers.** The Shiki client and the tree-sitter session keep and return a store. The minimap
  derives its patch with `changedRangeTo` and resolves one colour per palette entry. Sticky
  scroll, the view snapshot's paint runs, the diff plugin and rich-text copy read row slices; the
  diff plugin's per-line token buckets are gone, because a sorted store answers a line by
  bisection. The decode plugin's colour cursor starts by bisection instead of at token 0.
- **Snapshot JSON.** `EditorViewSnapshotJSON.tokens` is the packed form
  `{ starts, ends, styleIds, styles }`. The `'plain-overlap'` replay fidelity is removed: it marked
  overlapping input with no defined order, and a store always has one.
- **Deleted.** `editor/tokenIndex.ts`, `splicePackedEditorTokens`, the `Proxy` projection and its
  three paths, `copyTokenProjectionMetadata`, `sourceTokensForProjectedTokens`,
  `editorTokensEqual`, `tokenStylesEqual`. `unpackEditorTokens` gained the range form.

## Results

`bun run --cwd packages/editor bench:tokens`, 200 keystrokes into one token with the highlighter
answering each, median per keystroke:

| Stage                           | 500k tokens | 2.5M tokens |
| ------------------------------- | ----------: | ----------: |
| project through the edit        |   0.0014 ms |   0.0010 ms |
| splice the re-tokenized line    |   0.0014 ms |   0.0010 ms |
| view compares answer and shown  |   0.0004 ms |   0.0002 ms |
| minimap changed range           |   0.0003 ms |   0.0002 ms |
| read one row's tokens           |   0.0003 ms |   0.0002 ms |
| total                           |    0.004 ms |    0.003 ms |
| one keystroke at each of 200 distant lines, median | 0.025 ms | 0.11 ms |
| the same, worst keystroke       |     0.69 ms |     0.24 ms |

The distant-lines rows are the store's bad case: every new place adds two segment boundaries, and
past the cap each one pays for a pair merge.

## What still scales with the document

- A full answer (open, theme change, a highlighter that re-sends everything) builds a store from
  packed arrays and checks every style id once.
- `toPacked` and the JSON snapshot copy the document's tokens. Both are explicit exports.
- A store with non-monotonic ends is copied per edit, as above.
- The Shiki worker's own line-based re-tokenization is unchanged and out of scope.

Object tokens remain at the input boundaries named above, in `toTokens(from, to)` for callers that
want a row as objects, and inside the diff plugin, whose projected rows are a short document.

## Verification

- [`tokenStore.test.ts`](../../packages/editor/test/tokenStore.test.ts): slice bounds at both ends,
  patch and range replacement, palette identity, provenance, the changed range between a projection
  and the answer that replaces it, and 600 scattered edits checked against a plain array model.
- The projection tests in `editor-helpers.test.ts` assert the same results as before through
  `toTokens()`, and that a 5,000-token suffix costs one visited token.
- The spliced-equals-fresh assertions in `shiki-worker.test.ts` and `workerClient.browser.test.ts`
  are unchanged and pass with no unpack in the path.
