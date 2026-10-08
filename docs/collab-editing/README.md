# Collaborative editing research

Research for [E066](../../plans/e066-collaborative-text.md),
[E067](../../plans/e067-webrtc-collaboration-plugin.md) and the
[Delta DB plan](../../plans/delta-db-implementation-plan.md), done on 2026-10-08 at Fregat
`1e066d38b`. Each lane was source inspection: no upstream tests were run and nothing was timed.
Paths are relative to the repository root; `references/` clones are gitignored.

| Lane | Report                                                         | Question                                                                                       |
| ---- | -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| A    | [a-textbuffer-mapping.md](a-textbuffer-mapping.md)             | How Weidner's host-ordered model maps onto the Singapore textbuffer                            |
| B    | [b-placement-and-tests.md](b-placement-and-tests.md)           | Which placement rule the host uses, and which Loro, Yjs, Diamond Types and Fugue tests to port |
| C    | [c-undo.md](c-undo.md)                                         | Undo of one author's edits while others keep editing                                           |
| D    | [d-webrtc-plugin.md](d-webrtc-plugin.md)                       | The peer-to-peer WebRTC plugin: transport, host election, presence, hooks                      |
| E    | [e-fregat-host-and-delta-db.md](e-fregat-host-and-delta-db.md) | Fregat's server as host, disk and agent edits, and the Delta DB revision                       |
