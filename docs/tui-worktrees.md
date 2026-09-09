# TUI worktrees and session creation

Plan 083 completed on 2026-09-08.

The terminal client uses the same [worktree lifecycle](worktree-lifecycle.md) as the web app.
The [TUI README](../apps/tui/README.md#choose-and-manage-worktrees) describes the controls.

## Creation

A draft saves its current/new checkout choice alongside the prompt. Selecting New worktree
changes intent only. The first send supplies IDs to the shared command builder; the server
chooses paths and branches, pins the base commit, and provisions the checkout before starting
the provider. Existing sessions cannot change their worktree.

An uncertain acknowledgement retains the original command, session, turn, and worktree IDs.
A confirmed rejection preserves the prompt and permits a fresh command. Accepted creation
failures remain visible in their session. Retry uses the original saved base commit and releases
the original blocked turn. Prompt history restores content while preserving the current
checkout choice.

## Navigation and status

Draft navigation carries the exact worktree ID through remembered state, history, addresses,
terminal context, settings, and workbench entry. An unavailable explicit checkout produces an
unavailable state. Selecting another checkout retains each checkout's own draft.
Addresses ignore removed and retired records when a checkout path is reused. Resolution requires
one current identity; unknown or ambiguous paths fail explicitly.

Session rows and stage headers use the same worktree summary. It includes branch, lifecycle
failure, protected or external ownership, shared session count, and known cleanup changes.
The project manager remains reachable without a session, including after the last deletion.
Dialogs restore prompt focus when the selected checkout does not change.
Project worktree commands remain available with the rail hidden. If another client deletes the
project while its manager is open, the manager closes and rail commands remain available.

## Lifecycle management

Shared labels, cleanup eligibility, and command builders live in
[`client-core/chat/worktrees`](../packages/client-core/src/chat/worktrees/cleanup.ts).
Both clients import them. The TUI adds native checkout selection, worktree details, and
confirmation dialogs without adding mutation routes or client-owned Git operations.

Safe cleanup and release require confirmation. Force cleanup and missing-checkout resolution
first read a server preview, then submit its authorization with the confirmed command. The
server rechecks current ownership, session references, processes, and the preview fingerprint.
The UI also prevents cleanup of its selected checkout. Retry, retain, adoption, and release
use the existing lifecycle commands.
At the minimum 40-column, 12-row size, the action list scrolls to keep the selected action visible.
Page Up and Page Down scroll the details separately, including long paths and cleanup warnings.

## Verification

Focused tests use native OpenTUI rendering, the real in-process server, the production
MockProviderAdapter, and temporary Git repositories.

- [Submission](../apps/tui/src/agent-stage/tests/submission.test.tsx) and
  [creation recovery](../apps/tui/src/agent-stage/tests/worktree-creation.test.tsx) cover first-send
  isolation, provider checkout, rejection, lost acknowledgements, and the saved retry commit.
- [Native mode selection](../apps/tui/src/agent-stage/tests/worktree-selection.test.tsx) covers
  draft preservation, first-send timing, isolated-session commands, and non-Git refusal.
- [Checkout navigation](../apps/tui/src/agent/tests/checkout.test.tsx) covers linked checkout
  addresses, persistence, workbench entry, and missing-checkout refusal.
- [Address reuse](../apps/tui/src/navigation/tests/address.test.ts) covers removal, registration of
  a replacement checkout at the same path, and session creation in the resolved live checkout.
- [Rail access](../apps/tui/src/agent-rail/tests/worktree-access.test.tsx) covers hidden-rail
  commands, dialog focus restoration, and project deletion while the manager is open.
- [Focus](../apps/tui/src/agent-stage/tests/checkout-focus.test.tsx) covers selecting the same
  checkout, canceling management, and starting a draft there.
- [Manager](../apps/tui/src/worktrees/tests/manager.test.tsx) covers access after the last session,
  safe cancellation, dirty cleanup, separate force confirmation, protected/current refusal,
  visible errors when opening a missing checkout, and readable actions and warnings at 40×12.
- [Narrow picker](../apps/tui/src/worktrees/tests/picker.test.tsx) covers filtered selection of
  a linked checkout and refusal of a blocked checkout at 72 columns.

TUI build, TUI/web/client-core typechecks, changed TypeScript lint and formatting, and the
focused native and migrated web worktree tests pass.

The live native frame is `/work/tmp/platform-tui-083-frame.txt`, captured from the existing
server at `http://127.0.0.1:3301` with the new shared worktree labels visible.
