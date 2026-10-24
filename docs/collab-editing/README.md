# Collaborative editing

Source-inspection reports for collaborative text editing in the editor. Singapore code comments and test notices cite these files by path.

The reports cover collaborative text, the peer-to-peer WebRTC collaboration plugin and the Delta DB host. They were written on 2026-10-08 against Fregat `1e066d38b`. They are source inspection: no upstream tests were run and nothing was timed. Paths are relative to the repository root; `references/` clones are gitignored.

| Report                                                         | Question                                                                                       |
| -------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| [a-textbuffer-mapping.md](a-textbuffer-mapping.md)             | How Weidner's host-ordered model maps onto the Singapore textbuffer                            |
| [b-placement-and-tests.md](b-placement-and-tests.md)           | Which placement rule the host uses, and which Loro, Yjs, Diamond Types and Fugue tests to port |
| [c-undo.md](c-undo.md)                                         | Undo of one author's edits while others keep editing                                           |
| [d-webrtc-plugin.md](d-webrtc-plugin.md)                       | The peer-to-peer WebRTC plugin: transport, host election, presence, hooks                      |
| [e-fregat-host-and-delta-db.md](e-fregat-host-and-delta-db.md) | Fregat's server as host, disk and agent edits, and the Delta DB revision                       |
