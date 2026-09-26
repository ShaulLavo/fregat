# Next wave (wave 2)

Planned 2026-09-26 by the next-wave coordinator. Approved by the owner the same day; starts once
the completion-wave merge train is done (lanes branch from a `main` that has L1, L4, L6 and L7). Goal: with wave 3, finish every
remaining plan in Platform and Editor. Wave 2 runs everything that research round 2 left ready;
wave 3 runs what wave 2 unblocks.

Inputs: the [inventory](/work/reports/next-wave/README.md), the
[owner questions log](/work/reports/next-wave/owner-questions.md), and each plan file (every answer
is recorded there as "Decided 2026-09-26: owner").

## What changes from the completion wave

The completion wave ended in a merge train: nine lane PRs of 113–628 files each, 11–23 conflicts per
merge, and a day of rebasing. Wave 2 keeps the lanes and changes how work lands.

1. **One PR per plan (or per phase group), not per lane.** A lane opens a PR when a plan's phase
   group is done, and the coordinator merges it as soon as CI is green. PRs stay small, so there is
   no train at the end. A lane rebases before each new PR, not once at the end.
2. **One merge queue.** Only the coordinator merges to `main`. Lanes never push to `main`. While a
   batch of PRs is merging, nobody else pushes to `main` either (owner rule, 2026-09-26).
3. **No shared dev server.** Each lane starts its own Vite on its port when it needs one and stops
   it after (owner rule, 2026-09-26).
4. **Fixture providers only.** No scenario or test may fall back to a real Claude or Codex model.
   A run that would spend a real turn is a hard stop (research round 2 spent one by accident).
5. **At most eight lanes at once.** The machine has 31 GB; the completion wave hit oomd. Tier 1
   starts together; a tier 2 lane starts when a tier 1 lane finishes. Heavy jobs still go through
   `/work/tmp/wave-heavy/run.sh`.
6. **Visual review goes on a web page.** The owner reviews from a MacBook; screenshots that need a
   decision are published to the review page, never pointed at as local paths.

## Hard stops (ask the owner, do not guess)

- Spending money or account credit; any real-provider turn.
- Owner-only checks: the phone (143), the Mac (114 Gate 3, 151). Land the code, record "owner check
  pending".
- Deleting user data outside fixtures; editing real `~/.claude`, `~/.codex` or `~/.platform`
  without restoring it byte for byte.
- A decision the plan has no recommendation for. Open D-numbers with a recommendation: take it and
  write `Decided <date>: recommendation (wave 2)`.

## Owner decisions still open before or during the wave

| Plan | Question                                                                        | Blocks                     |
| ---- | ------------------------------------------------------------------------------- | -------------------------- |
| 176  | Parser behind live preview (lezer recommended); chat parser after               | 176 P1–P4, 108 P2 (wave 3) |
| 182  | Q3 multibuffer vs results document, Q4 long lines (third research pass running) | 182 E1–R5 (wave 3)         |
| —    | Merge cadence and lane count below                                              | Starting the wave          |
| —    | Project LICENSE                                                                 | Nothing scheduled          |

## Lane protocol

As in [the completion wave](completion-wave.md) (worktree per lane, own port, `TMPDIR=/work/tmp`,
`LEFTHOOK_EXCLUDE="typecheck repo"`, settings regenerated on rebase, `bun run gates` before each
PR), except for the landing rules above:

```bash
git worktree add /work/worktrees/platform/w2-<lane> -b w2/<lane> origin/main
# per plan or phase group:
git fetch origin && git rebase origin/main && bun run gates
git push -u origin HEAD:w2/<lane>-<plan> && gh pr create --base main --title "<plan>: <what>" --body "…"
```

Editor lanes open an Editor PR first; its Platform half bumps CI's pinned `editor-ref` in the same
PR (AGENTS.md), so an Editor merge never reddens other PRs.

## Lanes

Port = the lane's `WEB_PORT`. "Owns" is where it may change files freely; anything else is a small
commit named in the PR body.

### Tier 1 (start together)

**B — bugs · port 5230 · first to merge.** Small PRs, one per bug, each with a failing-before test
or scenario.

1. 174 P2: Claude sessions gate a repo's `.mcp.json` servers until approved (security).
2. 179 P2 + P4: sanitizer `user-content-` prefix (raw HTML clobbers `document` globals); `/fs/blob`
   `nosniff` and `CSP: sandbox` (security).
3. 112 P1: raise the body limit above the open limit; 128–200 MiB saves stop failing (data loss).
4. 184 slice 1: `jszip` and `subset-font` in `RUNTIME_PACKAGES`, proven on an isolated release install.
5. 144 P1: harness-started turns are kept; a prompt during one gets its own result.
6. 177's cache bugs: checkpoint diff whitespace miss, uncached `POST /fs/workspace-address`, the
   symbol search / breadcrumbs key collision, `select_file` logging `[circular]`.
7. 110 index freshness: ready-with-missing-file, nested `.gitignore`, `failed` recovery; the NUL
   byte in `session-registry.ts`; UTF-16 BOM as text.
8. 126 batch A: the seven scenario-harness defects; the dev transcript-download 401.
9. 182 P2: scroll recorder without a layout read.

**E1 — Editor core · port 5221.** Owns the Editor repo's editor, tree-sitter and plugin host;
Platform's `features/editor/**`.

1. 182 P1: grammar signature computed once (774 MB serialised per scroll today).
2. 170 Editor fix (owner: first): sessions send their grammar once, edits send none, worker dedupes.
3. 179 P1: occurrence-highlight `<style>` churn.
4. 176 P0 (now M): table cells parsed, the 255-paragraph cap gone, injection child-node rule, and
   the worker fixes from the calibration: re-find paragraphs only where the edit reaches (today 12 ms
   per keystroke at 46 KB, 34–77 ms at 1 MB), stop reads at each range end, one idle reparse after a
   full parse; long-doc scenario. Branch `research/176b` holds the measurements.
5. 122 P1–P2: E027 lifecycle ownership; per-event dispatch (quadratic loop, double pass).
6. E057: delete the SAB transport.
7. 122 P3–P5: `createPlugin` (one public API, owner), E026 commands, E028 modal (keys split by
   chord, owner).

**E2 — Editor host features · port 5222.** Owns the Editor's replacements, wrap and new spellcheck
package; the composer only in its last step.

1. 111 P1: atomic replacements for hosts (+ 171's extras).
2. Word-boundary wrap, then E052 proportional wrap (owner: composer prerequisite).
3. E058 P1–P3: spellcheck engine, editor squiggles, Platform settings and menu.
4. If 1–3 land: 171 P3, the composer on our editor, Lexical deleted in the same pass (wave 3
   otherwise).

**T — file tree · port 5223.** Owns `packages/tree/**`, the tree's feature files, `lib/*icon*`,
`scripts/icons/`.

1. 178 parity-harness → out-of-the-root → app-owned-state.
2. 178 icons with 180 P1–P4 (generator, tokens, aliases, two hues, light 700s, Codicons NOTICE)
   and Catppuccin glyphs in their own hues.
3. 178 rows → chrome → context-menu (one after the other: same row component).
4. 178 helpers; 178 tree-leads.

**S — settings and shortcuts · port 5224.** Owns `features/settings/**`, the settings registry
shape, keymap resolver and recorder.

1. 167 Part D `dependsOn` first (177's settings need it), then Parts A, B, C.
2. 166 P1–P6 as drawn (mockups approved), settings search finds shortcuts; then P7 several
   shortcuts per command.

**A — agents and harness · port 5225.** Owns `provider/**` (adapters), orchestration turn paths,
`features/chat` session and review surfaces.

1. 144 P2–P3: sleeping sessions, goals.
2. 169: agent review mode.
3. 140 P4: diagnostics fed back through harness hooks.
4. 087 M0 build, then M1 (scope decided).
5. 141 P5 with fixtures; 126 batch C (runtime scenarios, RUNTIME-07 recheck).

**W — workspace and machines · port 5226.** Owns `apps/server/src/fs/**` index and scopes,
`machines/**`, project registration.

1. 173: scopes per root (one index per root, cap 4, 15 min warm), web generation deleted,
   two-context scenario.
2. 110 per-root indexes and the derived-layer contract.
3. 170 P1–P5 after E1's Editor fix lands.
4. 172 P2 routing (one stack per domain); 126 batches B and E (E after #32).
5. LIFE-12 project settings page; LIFE-09 subprojects last (owner: after batches A–E).

**O — ops and desktop shell · port 5227.** Owns `scripts/deploy/**`, `apps/desktop/**`,
dependency manifests, `vite.config.ts`.

1. 184 slices 2–7 (cheerio, jszip, web-push, sharp, dead deps, dedupe, notices).
2. 147 P3 gate; 132 leftovers after L6's P4.
3. 114 Gate 1 (Chromium launcher on Linux, no Rust), Gate 2 (native fallback host), Gate 3 (macOS,
   owner check pending), Gate 4 (delete Electrobun) once 1–3 hold.

**F — files, previews and prefetch · port 5228.** Owns `features/files` open paths, diff queries,
`features/chat` markdown rendering, `lib/prefetch`.

1. 177 P0–P2, P4–P5 (P3 needs E1's prepared-syntax API; schedule with E1).
2. 156 P0–P2: binary files stop opening as text, pdf.js viewer, CSV table.
3. 179 P0, P3, P5, P6: trace instruments, mermaid in a shadow root, app CSS, AGENTS.md rule.

### Tier 2 (start as tier 1 lanes finish)

**D — documents and large files · port 5229.** 099 units 0–1 (harness extension first), then 112
P2–P4 (raw-byte transport, thresholds after the minimap fold fix, tiers).

**V — virtual lists and search · port 5231.** 181 (reproduce owner's chat scroll list first), then
178 virtualization once T's app-owned-state lands, then 178 keyboard-and-selection; 182 P3.

**M — MCP and composer rows · port 5232.** 174 P1, P3–P6 (status, settings page, add/copy,
per-session off, paste-back sign-in); 126 batches D and F.

**P — phone · port 5233.** 143 P1–P4 (shell frame, screens, touch, sessions and pairing). Device
checks are owner checks.

## Wave 3 (what wave 2 unblocks)

171 composer (if E2 did not reach it); 111 P4–P5 → 108 P2–P3; 176 P1–P4 after the owner's
decision; 182 E1–R5 per Q3/Q4; 122 P6–P9 and E025; 088 after 087; 178 drag-and-drop and cleanup;
143 P5–P6 and 155 (after 143); 156 P3–P5; 126 batches G (four drivers), H (pairing, balancing),
I (PR review workspace); 177 P3 if it slipped.

## Parked

183 (Claude IDE lock file, low priority); DOCX editing (after the markdown work); project LICENSE;
E011, E015/E016 until 112 says so; E023; 105 P4.

## Owner decisions on this plan (2026-09-26)

- One PR per plan (or phase group), merged continuously by the coordinator.
- At most eight lanes at once; 13 lanes in two tiers.

## Running it

Start conditions: the merge train is done (L6's 132 P4 and `query:check` rerun included), the
coordinator has landed `coord/next-wave`, and `origin/main` is green.

Each lane is one session in `/work/projects/platform`, started with:

> You are lane `<X>` of wave 2. Read `docs/next-wave.md` (your lane, the protocol and the landing
> rules) and `AGENTS.md`, then work through your queue. Every run starts by finding your place:
> your worktree `/work/worktrees/platform/w2-<x>`, your branch log, and your open PRs
> (`gh pr list --author @me --head w2/<x>`). One PR per plan or phase group; never push to `main`;
> start your own Vite on your port only while you need it. Hard stops go under "Owner questions" in
> the plan and the PR body; skip the item and continue.

The coordinator merges PRs in arrival order (bug lane first, Editor PRs before their Platform
halves), deploys after each merged batch with `bun run deploy` (`--server` when the server changed),
and keeps `plans/README.md`, `PLAN.md` and the review page current.
