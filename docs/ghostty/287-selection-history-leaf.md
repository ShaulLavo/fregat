# Selection and history ownership

This design note explains the selection and history boundary for developers integrating the
main and worker terminal entries. [Approved Plan 287](../../plans/287-ghostty-worker-mode.md) owns delivery.

`NativeSelectionHistory` uses the execution actor's existing `TerminalSession` for native selection
gestures, text, history and render state. A synchronous selection read returns text and deep-owned
coordinates with one native revision, terminal generation and committed layout.
History snapshots own their lines and scrollbar. A changed identity during either read fails.
Selection text and full history are requested on demand. Frame summaries carry coordinates only.

Projected pointer intents accept the submitted generation, layout and native revision. The native
helper checks that identity before mutating. A gesture retains a bounded range of its own contiguous
selection and scroll revisions so queued drags can use the same submitted projection. External output,
reentrant writes, layout/generation changes, reset and a new gesture invalidate that range.
The host controller owns capture/gesture lifetime and accepts synchronous results or asynchronous
acknowledgements. It holds pointer ownership immediately,
ignores obsolete acknowledgements and permits one outstanding autoscroll tick. Its optional projection
refresh reads the latest committed submitted geometry before a tick.

The main terminal API keeps synchronous authoritative results. Worker commands use the same names
and arguments with promise results. Host focus, input claim/pass and submitted `visibleLines` keep
their synchronous convention. Extension registration follows the entry's execution mode.

The async copy helper calls `clipboard.write` during the trusted event, with a `ClipboardItem` whose
text blob resolves from worker readback. It rejects unsupported delayed clipboard writes. An abort
signal rejects pending text on host disposal. It obtains no read permissions or clipboard reads.
The existing OSC 52 policy adapter is unchanged. Native parser policy acceptance and asynchronous
browser completion retain their separate meanings.

## Execution and host wiring

`LocalTerminalExecution` instantiates the helper beside its existing native session and supplies the
execution generation and committed layout. The worker runtime routes atomic selection readback and
selection gestures through that native owner. `selectionSnapshot` is an internal transport command;
the public selection and history API keeps its existing names and return conventions.
The existing public `captureViewport` remains native-owned. The standalone
`captureSelectionHistoryViewport` helper also guards generation/layout/native/snapshot identity before
returning an owned serialization.

The typed transport routes `selectionSnapshot`, `selectionPress`, `selectionDrag`,
`selectionAutoscrollTick`, `selectionRelease` and `resetSelectionGesture`. Gesture intents carry the
submitted `SelectionIdentity` as their last argument. Mouse reports validate generation and cell layout;
acknowledged native metadata determines mouse tracking. Clean native updates publish their submitted
revision while retaining producer/control output accounting.

The host installs pointer selection for both execution modes. Autoscroll reprojects the last client
position using the latest committed geometry. Worker default copy starts the browser write in its
synchronous trusted-event claim and obtains text through atomic native readback. A custom string copy
callback runs after readback and has a separate activation contract. Host disposal aborts pending copy.
No extension or other closure crosses the worker boundary.

The tests execute real native sessions, the dedicated worker fixture and compiled main/worker public
entries with the real packaged worker. They cover queued gestures, strict external invalidation, pending
release cancellation and submitted accessibility. Clipboard checks use trusted events with no grants
or reads; real completion skips explicitly when the browser denies its ordinary activated-write baseline.
Links, IME, publication and the remaining Phase 2 matrix keep their separate owners.
