# Selection and history ownership

This design note explains the selection and history boundary for developers integrating the
main and worker terminal entries. [Approved Plan 287](../../plans/287-ghostty-worker-mode.md) owns delivery.

`NativeSelectionHistory` uses the execution actor's existing `TerminalSession` for native selection
gestures, text, history and render state. A synchronous selection read returns text and deep-owned
coordinates with one native revision, terminal generation and committed layout.
History snapshots own their lines and scrollbar. A changed identity during either read fails.
Selection text and full history are requested on demand. Frame summaries carry coordinates only.

Projected pointer intents accept the submitted generation, layout and native revision. The native
helper checks that identity before mutating. The host controller owns capture/gesture lifetime and
accepts synchronous results or asynchronous acknowledgements. It holds pointer ownership immediately,
ignores obsolete acknowledgements and permits one outstanding autoscroll tick. Its optional projection
refresh reads the latest committed submitted geometry before a tick.

The main terminal API keeps synchronous authoritative results. Worker commands use the same names
and arguments with promise results. Host setup, extension registration, input claim/pass and submitted
`visibleLines` keep their synchronous convention.

The async copy helper calls `clipboard.write` during the trusted event, with a `ClipboardItem` whose
text blob resolves from worker readback. It rejects unsupported delayed clipboard writes. An abort
signal rejects pending text on host disposal. It obtains no read permissions or clipboard reads.
The existing OSC 52 policy adapter is unchanged. Native parser policy acceptance and asynchronous
browser completion retain their separate meanings.

## Execution and host wiring

The packaged-worker lane owns runtime, transport, command envelopes, entry points, native lifecycle,
fonts, direct ports, generic DOM host, input and local/submitted interfaces, exports and builds.
It must instantiate this helper beside its existing native session, supply execution generation and
committed layout, route selection/history authority through it and expose `selectionSnapshot`.
The existing public `captureViewport` stays with that lane. The runnable
`captureSelectionHistoryViewport` leaf takes an existing session, submitted summary and identities,
holds capture on stale generation/layout/native/snapshot versions, and returns an owned serialization.
Core can reuse it in the capture command with the existing renderer and ABI.

The transport needs `selectionSnapshot`, `selectionPress`, `selectionDrag`,
`selectionAutoscrollTick`, `selectionRelease` and `resetSelectionGesture`. Gesture
intents carry the submitted `SelectionIdentity` as their last argument. Host input must reserve the
clipboard write inside its synchronous copy claim, pass an on-demand atomic selection read and
abort it on disposal. Host selection supplies the latest submitted identity and refreshed geometry.
No extension or other closure crosses the worker boundary.

The tests execute real native sessions on the main thread and inside a dedicated worker fixture.
The fixture proves the native requests and clone boundary. Packaged transport and public entry
checks belong to the execution integration. Clipboard tests use trusted browser clicks with no grants.

Landing and publication require #483, then #494, then #497, followed by packaged worker integration.
Product Phase 2 remains open until its public matrix passes. Version and provenance integration
remain coordinator-owned. Links, IME and accessibility have separate owners.
