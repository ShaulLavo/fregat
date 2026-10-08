# Third-party test notices

These synthetic workloads are adapted to Singapore ID-space edits. Provenance
headers identify their original tests and pinned revisions. Runtime dependency
notices remain in `THIRD_PARTY_LICENSES`. No Fugue B4 editing trace is included.

## Loro

Source: https://github.com/loro-dev/loro
Revision: `c00c9fa501f8d32f68d6255eacb7035a67fb6ab6`.
Adapted placement, tombstone-origin, Unicode, cursor, plain-text generator and undo tests.

`test/ported/loro-undo.test.ts` covers all 15 undo scenarios listed in
`docs/collab-editing/c-undo.md` §5. Rich-text marks are excluded. Provenance-only
steps advance history, and revival reuses original IDs. The cursor scenario keeps
its two remote insertions and captured endpoint identities. Tombstone origins
place the remote insertion before the revived original span; endpoint offsets
therefore differ from Loro's fresh-ID restoration.

MIT License

Copyright (c) 2023 Loro

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Yjs

Source: https://github.com/yjs/yjs
Revision: `d01eefc997cf12d29d5aabea804df5f69c659a79`.
Adapted basic text, character-array, relative-position, message scheduler and undo tests.

`test/ported/yjs-undo.test.ts` ports the plain-text aspects of `testUndoText`,
`testUndoEvents`, `testTrackClass`, `testTypeScope`,
`testUndoUntilChangePerformed`, `testConsecutiveRedoBug`,
`testSpecialDeletionCase` and `testUndoDoingStackItem`. Scope is one document,
origins are captured local edits, and metadata stays caller-owned. No-visible-change
undo advances one transaction. `testUndoDeleteFilter` and
`testUndoNestedUndoIssue` are explicitly skipped because protected targets and
nested shared objects have no plain-text counterpart. Attribute/formatting tests
remain outside the package's scope.

The MIT License (MIT)

Copyright (c) 2023

- Kevin Jahns <kevin.jahns@protonmail.com>.
- Chair of Computer Science 5 (Databases & Information Systems), RWTH Aachen University, Germany

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## FugueMax reference oracle

Source: https://github.com/mweidner037/fugue
Revision: `31e74fea67f23add13a5d10f781c0d78edcd14da`.
The test oracle adapts `fugue-max-simple/src/index.ts`. It retains the tree
placement and traversal and removes the Collabs transport and serialization.
The MIT grant below applies to that subtree. Its exceptions for `fugue/` and
the B4 dataset are outside these ports.

All files in this project, except b4-editing-trace.js and the fugue/ directory, are licensed under the MIT license:

The MIT License (MIT)

Copyright (c) 2023 Matthew Weidner and Martin Kleppmann.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

## Diamond Types

Source: https://github.com/josephg/diamond-types
Revision: `89ae3a0ab8d941a2885e6ec89d094bc9ce9d2922`.
Adapted synthetic local editor, backward insertion/backspace, concurrent deletion
and merge-generator workloads. The implementation uses Singapore envelopes and
an independent scalar-array oracle. Rust fixtures and encoded data are excluded.

Upstream declares ISC in `Cargo.toml` and `README.md`. This revision supplies no
standalone license file or copyright line. Attribution is to Seph Gentle and
Diamond Types contributors, consistent with the source repository and commit
author. No copyright year has been inferred. The full ISC permission and
warranty text follows.

ISC License

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted, provided that the above
copyright notice and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES
WITH REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF
MERCHANTABILITY AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR
ANY SPECIAL, DIRECT, INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES
WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION
OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION, ARISING OUT OF OR IN
CONNECTION WITH THE USE OR PERFORMANCE OF THIS SOFTWARE.

## Zed undo semantics

Source: https://github.com/zed-industries/zed/tree/dc3fb21676457b84d2233ac4c6bec5cebc698ec3/crates/text
Revision: `dc3fb21676457b84d2233ac4c6bec5cebc698ec3`.
`crates/text` is GPL-3.0-or-later, as stated in its `Cargo.toml` and `LICENSE-GPL`.
No Zed code, fixtures, comments or translated implementation are included.
`test/ported/zed-undo.test.ts` independently implements the documented semantic
scenarios for `test_undo_redo`, `test_finalize_last_transaction`,
`test_concurrent_edits`, `test_edit_partially_intersecting_a_deleted_fragment`,
`test_random_concurrent_edits` and `test_edit_undo_after_split` using Singapore's
public API and fresh fixtures. The provenance header identifies this distinction.

## Singapore scenario coverage and follow-ups

`test/undo.test.ts` exercises the package-layer behavior from the 14 cases in
`docs/collab-editing/c-undo.md` §5. The following remain with their owning layers.

| Case | Package coverage or follow-up                                                                                                                |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Atomic transaction activation switches sibling effects and preserves remote work. Editor graph traversal follows in the editor lane.         |
| 2    | Grouped replacements reverse insertion and deletion together.                                                                                |
| 3    | Initiating-view multi-cursor selection restoration requires the editor view layer.                                                           |
| 4    | Same-ID revival and retained positions are covered. Jump history integration requires the editor.                                            |
| 5    | Pending edit, undo, redo and remote replay capture local history once. Editor graph-node counting follows in the editor lane.                |
| 6    | Repeated confirmations and command retransmission are deduplicated.                                                                          |
| 7    | Deletes arriving at already-hidden spans retain independent provenance.                                                                      |
| 8    | Save/reopen graph and anchor persistence requires editor storage.                                                                            |
| 9    | Identity-keyed persistence rejection requires the editor persistence format.                                                                 |
| 10   | Clearing retained undo entries leaves baseline effects active. Graph pruning follows in the editor lane.                                     |
| 11   | Engine snapshots preserve provenance and command identities. Full host outcome/frontier transfer belongs to the collaboration session layer. |
| 12   | Rejected commands and blocked dependants recover prior local history. Editor graph recovery follows in the editor lane.                      |
| 13   | Provenance-only undo is accepted, sequenced and retained in snapshots. Durable storage follows in the persistence lane.                      |
| 14   | File-tree shared-head undo integration belongs to Fregat's app layer.                                                                        |

## Concurrent undo verification

`src/visibility-model.ts` is an independently written scalar model. Every retained
UTF-16 code unit has its insertion operation and all deletion operations, including
deletes applied while hidden. Accepted host envelopes build the confirmed model.
Each participant check uses that participant's confirmed host prefix and replays
its pending, unblocked envelopes. Every simulation step checks visible text and
visibility per identity before and after delivery. Placement order is inspected
separately from the model's visibility decisions.

`test/review-regressions.test.ts` includes the transport impersonation and remote
capture reproductions. Its mutation control replaces visibility with a deliberately
incorrect last-deletion-only rule and requires the simulator's scalar oracle to
reject it. Remote effect commands resolve their original operations' identity spans
for capture grouping; intersecting undo and redo seal the group, while disjoint
commands keep it open.

`Host.submit(envelope, sender)` requires the submitting author's authenticated
session identity. A network adapter must get this value from its registered peer
session. `InMemoryTransport.submit(participant, envelope, delay)` binds the sender
to a participant registered when the transport was created, independently of the
envelope. Missing, unregistered and mismatched senders fail before sequencing.
