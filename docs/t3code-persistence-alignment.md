# T3Code Parity — Client Persistence

> **Measured 2026-09-22.** Reference at `references/t3code` commit `4a560b4e`; ours at the
> persistence cut described below. Sibling of `docs/t3code-parity-second-sweep.md`, which does
> not cover this dimension. Same discipline as that sweep: a capability whose only callers are
> its own tests is recorded as **absent**, not present.
>
> Effort scale: **S** ≤ 1 day · **M** 2–4 days · **L** 1–2 weeks.

---

## 1. Bottom line

We now agree with the reference on **what** to persist and disagree on **how staleness is
retired**. The what was settled by the persistence cut (2026-09-22): persist the user's
intent, never an answer the server can regenerate. The how is still ours, and it is the weaker
half — we retire stale records by calling a function, and the reference retires them by
refusing to write them.

This matters because an explicit `clear()` is exactly the thing that rots. Ours did:
`clearTimelineReload` shipped unwired in `d1ca6472`, the same commit that created the feature,
and for a month its only caller was a test's `beforeEach`.

## 2. The reference's mechanism

Ten persisted stores, all Zustand `persist` with `createJSONStorage`, each carrying a
`version` and usually a `migrate`. Pruning happens inside `partialize`, at every
serialization, from live state. `apps/web/src/composerDraftStore.ts:2095` is the reference
implementation and its comment names the failure mode:

> Everything else is a zombie — and its composer blob must be dropped WITH it, or
> model/mode-only entries would persist forever keyed to a session that no longer exists.

Three rules, applied on the write path:

1. **Liveness** — compute the set of keys still reachable (mapped to an active flow, mid-send,
   or holding real user content) and write only those.
2. **Zombie** — a record keyed to an entity that no longer exists is dropped with the entity,
   never left addressed to a dead id.
3. **Inert** — a record whose every meaningful field is empty is not written at all
   (`continue`), so an empty key never reaches storage.

There is no `clear()` for composer drafts anywhere in the reference. Nothing has to remember.

## 3. Where we stand

Only the multi-key records can drift at all. Most of ours are a single slot per root or per
environment, overwritten by the next capture, so the reference's pruning would have nothing to
prune. The table therefore separates the two shapes.

**Multi-key records — where the rules apply:**

| Our record                                 | Prunes on write | Rule used                                                                   | Gap                                                                                                                                                                                                                   |
| ------------------------------------------ | --------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `workspace/state/cache.ts` slices          | ✅              | `WORKSPACE_SLICE_LIMIT` cap, plus removal paths that drop per-location keys | none                                                                                                                                                                                                                  |
| `platform.chat-session-reads.v1`           | ✅              | `prunedSessionReads`: newest `MAX_SESSION_READ_ENTRIES` by stamp            | cap, not liveness — a dead session can hold a slot a live one wanted                                                                                                                                                  |
| `platform.chat-changed-files-expansion.v1` | ✅              | `pruneScopedRecord` + `pruneChatChangedFilesExpansion`, per scope           | as above                                                                                                                                                                                                              |
| `platform.chat-input-drafts.v1`            | ➖              | none                                                                        | **sharpest gap.** Unsent text keyed by thread, the one record we agreed is unrecoverable, and a draft addressed to a deleted session outlives it. The reference drops the composer blob with the thread. Effort **S** |

**Single-slot records — structurally cannot accumulate:**

| Our record                         | Zombie rule | Note                                                                                                                                                        |
| ---------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat.timeline-view.v1`            | ✅          | added 2026-09-22 via `discardTimelineReloadForSessions`, driven by the server-confirmed `session.deleted` event rather than the UI action                   |
| `terminal.display.v1`              | ❌          | `discardTerminal` exists and is live, but it fires on paint _rejection_, not on session kill; scrollback for a killed session is retained until overwritten |
| `git.view.v1`                      | ❌          | a diff view keyed to a comparison that no longer exists is inert but retained                                                                               |
| `settings.view.v1`, `logs.view.v1` | n/a         | no entity to outlive                                                                                                                                        |
| `platform.environments.binding.v1` | ➖          | one per environment                                                                                                                                         |

✅ follows the rule · ➖ absent · ❌ divergent · n/a rule does not apply

So the accumulation risk is already handled, and handled _the reference's way_ — pruning
inside the write path, in `writePersistedSessionReads` and the expansion store's serializer.
Both use a **cap** where the reference uses **liveness**: we keep the newest N regardless of
whether those sessions still exist, so a deleted session can occupy a slot a live one wanted.
Bounded and self-healing, but it decides by recency what the reference decides by reachability.

## 4. What we adopted, and where it is enforced

- **Persist intent, never an answer the server can regenerate.** Derived from VS Code's
  `MarkerService` rather than t3code, but it is the same instinct; see
  `apps/web/src/features/address/utils/classification.ts`, whose table classifies every
  `platform.*` key and is drift-tested in `features/address/tests/classification.test.ts`.
- **Server-confirmed events, not UI actions, retire a record.** `chat.timeline-view.v1` is
  cleared from `chat-projection-store`'s event application, so an optimistic delete that the
  server rejects does not throw the view away, and the unmount flush cannot write the dead
  record back.

## 5. What to do next

1. Drop a composer draft when its thread is deleted (**S**). The only gap with real user cost.
2. Give `terminal.display.v1` and `git.view.v1` the zombie rule, on session kill and on
   comparison close, following the `discardTimelineReloadForSessions` shape (**S**).
3. Turn the two caps into liveness checks — prune `chat-session-reads` and
   `changed-files-expansion` against the live session set rather than by recency (**S**).
4. Consider a shared `partialize`-shaped seam so a new persisted record gets the rules by
   construction instead of by review (**M**). Until that exists, every new record is a chance
   to repeat this.

## 5a. Honest note on how this was measured

The first draft of the table marked `chat-session-reads` and `changed-files-expansion` as
following none of the three rules. Both in fact prune on the write path, which is the
reference's own mechanism — the claim came from grepping their store files rather than their
storage modules, where the pruning lives. Corrected before commit. Any future sweep of this
dimension should read the `write*` function, not the store.

## 6. Constraint worth recording

The obvious home for a "clear X when Y is deleted" hook is next to the delete, which for us is
`features/chat-mode/hooks/use-session-actions.ts`. That is a feature-to-feature import and
`platform-boundaries(feature-imports)` rejects it. Only `bun run --cwd apps/web lint` catches
this — not `bun run gates`, not `scripts/lint/web-boundaries.mjs`, not the boundary tests. Put
the invalidation inside the feature that owns the record and drive it from an event.
