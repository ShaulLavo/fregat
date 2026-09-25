# Completion wave

Started 2026-09-25. Goal: finish every executable plan in Platform and Editor, using parallel
agents in separate git worktrees. Each **lane** is one long-running agent that owns a set of
files and works through an ordered queue. Lanes are chosen so that two of them rarely edit the
same file.

Evidence for every status below is in `/work/tmp/completion-wave-audit/` (one report per plan
group, with commit hashes). Read the report for your plans before starting; the plan files'
own status lines are often stale.

## Owner decisions for this wave (2026-09-25)

- **Open D-numbers:** take the plan's written recommendation. Write
  `Decided 2026-09-25: recommendation (completion wave)` next to it in the plan, then proceed.
  Stop only for the hard stops listed below.
- **Scope:** finish everything executable now. The plans listed under Parked get one line
  saying why, and are not worked on.
- **Plan 148 D3 is replaced.** A `--server` deploy never restarts on a timer. It stages the
  release, and the app shows "Update available" with a Restart button. If turns are running,
  Restart first asks for confirmation and names the sessions it will interrupt. Nothing restarts
  until someone clicks.
- **Plan 126 definition of done:** a row closes when our `agent:browser` scenario proves the
  behaviour. The paired run against upstream T3 Code is dropped from every row.

## Hard stops (ask the owner, do not guess)

- Anything that spends money or account credit (Plan 141 P5 reset credits, 126 RUNTIME-08).
- Checks that only the owner can run: the phone (142 spike, 143), the Mac (151 live install).
  Land the code and record the check as "owner check pending". Do not block on it.
- Deleting user data outside fixtures, or editing the real `~/.codex` / `~/.claude` config
  without restoring it byte for byte.
- A decision the plan has no recommendation for.

## Worktree protocol (every lane)

**Setup**

```bash
cd /work/projects/platform && git fetch origin
git worktree add /work/worktrees/platform/<lane> -b lane/<lane> origin/main
cd /work/worktrees/platform/<lane>
ln -s /work/projects/platform/references references
bun install
```

`/work/worktrees/platform/Editor -> /work/projects/Editor` already exists. The
`packages/editor-*` symlinks resolve through it. Never delete it.

**Working**

- Run your own Vite on your lane's port: `cd apps/web && WEB_PORT=<port> bun ../../scripts/run-with-env.ts vite --port <port> --strictPort`.
  Drive it with `WEB_PORT=<port> bun run agent:browser …`, which spawns a throwaway API server
  from your worktree. The shared dev server on 5173 serves `main`'s code, not yours. Never use
  `--shared-dev` from a lane.
- Run tests with `TMPDIR=/work/tmp`, because `/tmp` is tmpfs and the LSP tests fail there.
- Commit with `LEFTHOOK_EXCLUDE="typecheck repo"`, because that job deadlocks in a fresh
  worktree. Typecheck `apps/server` and `apps/web` by hand before committing.
- Land small and often, one plan phase per landing. The longer a lane sits unlanded, the worse
  its rebase gets.

**Landing**

```bash
git fetch origin && git rebase origin/main
# generated files: regenerate, never hand-merge
bun run settings:schema && bun run settings:reference
bun run gates    # plus the narrow tests and typecheck your change could break
git push origin HEAD:main    # rejected? fetch, rebase, re-run gates, push again
```

**Deploying**: always from the main checkout, never from a worktree. A release's
`server/node_modules` is a symlink into the checkout that built it, so a release deployed from
a worktree breaks when that worktree is removed. The lock serializes deploys and Editor builds:

```bash
flock /work/tmp/platform-deploy.lock sh -c '
  cd /work/projects/platform && git pull --rebase --autostash &&
  bun run deploy --slug=<lane>-<plan> [--server]'
```

If the autostash conflicts, stop and report; another session's uncommitted work is in the way.
Then check `GET /platform/release`, and run `look` or a read-only scenario against the mesh.

**Shared files.** In `plans/README.md` and `PLAN.md`, edit only your own plans' rows, and
re-read the file right before you commit. Delete a plan file in the same landing as its last
phase. Database migrations: `git pull` before adding one, and renumber on rebase until L6 lands
132 P4 (after that there are no migrations).

**Editor** (lane L7 only). This is the only lane that edits `/work/projects/Editor`:

```bash
git -C /work/projects/Editor worktree add /work/worktrees/Editor/L7 -b lane/L7 origin/main
cd /work/worktrees/Editor/L7 && bun install && bun run build
```

- Test inside the Editor worktree: `test`, `bench:check`, `health`, `check:full-text`, and
  `format:check` with `packages/*/node_modules/.bin/oxfmt`.
- Never `bun link` from a worktree. It repoints every session's links. To try a change in
  Platform, repoint only L7's Platform worktree `node_modules/@singapore-editor/*` links
  (`bun install` restores them).
- Land the Editor change additively first: push `lane/L7:main`, then under the deploy lock
  `cd /work/projects/Editor && git pull --rebase --autostash && bun run build`. Then land the
  Platform half, and last any removals. Platform CI builds Editor `main`, so an API break
  without its Platform half turns CI red.

**Finish.** When the queue is empty: `git worktree remove /work/worktrees/platform/<lane>`, then
`git branch -d lane/<lane>`.

## Every run of a lane

A lane may run under `/loop`, so every run starts by finding its place:

1. Check that your worktree `/work/worktrees/platform/<lane>` exists; create it per the protocol
   if not. Read `git log origin/main` for what your lane already landed, and your plans' status.
2. Take the next unfinished item in your queue. Read the plan and its audit report, then
   reconcile the plan against current source.
3. Implement, then verify: narrow tests with `TMPDIR=/work/tmp`, `bun run gates`, and
   `agent:browser` on your port for anything visible (read the screenshot back).
4. Land (rebase, push `HEAD:main`), deploy from the main checkout under the lock, and update or
   delete the plan file in the same landing.
5. Open decision with a recommendation: apply it and write
   `Decided 2026-09-25: recommendation (completion wave)` in the plan. Hard stop: write the
   question under "Owner questions" in the plan, skip the item, and continue.
6. Queue empty: remove your worktree and report what landed, what was skipped and why, and the
   pending owner checks. Then end the loop.

## Lanes

Port = the lane's `WEB_PORT`. "Owns" lists the files the lane may change freely. Anything else,
touch only in small, quickly landed commits.

### W0 — bookkeeping (runs first, alone, short)

Other lanes rebase onto it, so it lands before they touch `plans/README.md`.

- Delete completed plan files: 101, 103, 106, 107, 113, 115, 116, 118, 119, 123, 127, 133, 136,
  137, 138, 146, and `145-harness-controls/approval-rules.md`. Close 125 (move its three
  deferred items to 147) and 105 (Phase 4 needs a mesh feature, so park it). Remove README row 073. Rewrite 075 down to its U1.
- Fix stale rows: 091–095 (partly done in `becdf722`), 126 (23 of 57 groups done), 130, 131,
  132, 141 (P1–3 done), 164 (first pass done). Fix PLAN.md's workaround-removal and React
  compiler lanes, its 2421 KB figure, and add 114 and 165.
- Editor: close E018, E033, E047 and E049 (a short reference doc each, plan deleted, backlog
  Completed); fix E051's links; add a backlog entry for the whole-document `commandDocumentText`
  copy; move E030 to Platform as a parked plan. Run `node scripts/check-editor-backlog.mjs` until it passes.
- `git worktree remove /work/worktrees/platform/plan-145-approval-rules` (merged in `89c58188`).

### L0 — font catalog (already running in the main checkout)

Plan 165 is being implemented, uncommitted, by another session in `/work/projects/platform`.
Until it lands, no lane touches `apps/server/src/fonts/`, `lib/fonts`, `boot-appearance.ts`,
`apply-appearance.ts`, or the settings registry, except through a rebase.

### L1 — UI base and polish · port 5211

Owns `packages/ui/**`, `globals.css`, `virtual-list.tsx`, the design census, `features/file-picker/**`.

1. **157** base components, all five units plus the scenario. Fold **102 P2** (one scrollbar)
   into 157's scroll-fade unit.
2. **102 P1** overscroll containment, then **P3** Kbd chip (take the D7 recommendation).
3. **158**: StatusFrame, ValueGrid and branch lanes, then tail-follow "N new" and checkpoint
   restore (these two need 157's dot).
4. **164** close-out: metadata font sweep, then delete the plan.
5. **159** file picker, P1–P6 in order (P3 and P4 may go early).
6. **124** theme studio, after L0 lands. Fold the `bundle ` scope into `theme ` (D12).
7. **154** physical mode last (take the D6 recommendation). P7 haptics is parked with 143.

### L2 — honest chat states · port 5212

Owns `apps/server/src/orchestration/{decider,provider-command-reactor,pending-requests,ingestion,projection}*`,
`packages/contracts/src/chat-model.ts`, `features/chat` timeline and approval components.

1. **131 P2**: `REQUEST_GONE` / `NOT_INSTALLED` codes replace the string matchers.
2. **161** honest states: reproductions first, then approvals, end reasons, markdown hold,
   folding, and the hostile-state scenarios.
3. **160** chat turn anatomy (after 161; they share `timeline-items`).
4. **163** screenshot in the composer (update its `OrbitLoader` mention to `Spinner`).
5. **131 P3**: tool identity, minimum CLI version, opaque stderr, PWD.
6. **126 stream C**, composer residues: INTERACTION-14 favourites, -13 background start, -11
   rich composer, -10 artifact templates, -09 source context, -08 multi-model send.

### L3 — harness controls and cost · port 5213

Owns `apps/server/src/provider/adapters/codex-protocol/**`, `provider/usage-*`, `features/chat`
message and session menus, `agents-panel`, Settings › Usage. It shares `claude.ts` and
`codex.ts` with L2: L2 owns approval and turn-end paths, L3 everything else. Land each change
in small commits.

1. **145** Codex schema refresh (once, first), then export, fork, background-tasks, hooks,
   mcp-status and custom-agents, each with its recommendation.
2. **162** context and cost.
3. **126 stream B**: compaction (INTERACTION-06 + RUNTIME-05) and provider updates
   (RUNTIME-10). RUNTIME-02's new drivers are parked (they need accounts).
4. **141 P4** backfill.

### L4 — server operations and boot · port 5214

Owns `apps/server/src/observability/**`, `scripts/deploy/**`, `apps/server/src/{index,app}.ts`,
`terminal/service.ts`, `terminal-host/`, `apps/web/scripts/bundle-*`, `vite.config.ts`.

1. **147** log hygiene: P1 server ‖ P2 client, then P3 gate (with 125's deferred items).
2. **148** in its redesigned form (see the decisions above): stage instead of swap, server
   drain, an "Update available" status item with a Restart button and a confirmation that names
   running sessions. Replace the plan's D3 text and delete the max-wait timer.
3. **149** terminal host (D2: quitting the desktop app kills its terminals, as recommended).
4. **132 P2 and P3** dev plumbing; fold **076** B (a full-process restart in dev) into it, and
   file the Bun `--watch` issue upstream.
5. **109 P4** first-load gate, plus the hashed-asset carry-forward; **109 P1** doc.
6. **129 Q2–Q4** (shiki in entry, evlog, minimatch); drop Q5.
7. **075 U1**: log the terminal renderer tier and show it.

### L5 — machines, rail and lifecycle · port 5215

Owns `apps/server/src/machines/**`, `installation/**`, `features/environments`, `features/chat-mode`
rail, the client-core rail, the TUI rail.

1. **150 P1** remainder, then **151**, taking D2/D4 as recommended (the live Mac install is an
   owner check), then **152**.
2. **126 stream D**: LIFE-13 (Undo + mod+z, precedence per 080), LIFE-14 badge, LIFE-12, LIFE-11,
   LIFE-09. The two-machine runs go last, once 151 lands.
3. **142** web push: code P1–P2 with the recommendations. The phone spike is an owner check.

### L6 — helpers, plumbing and React rules · port 5216

Owns `packages/{utils,observability,contracts/src/*uri*}`, `apps/web/src/lib/*error*`,
`apps/server/src/{utils,db}/**`, `scripts/lint/**`.

1. Live bugs first: **095 U6** (registry stream abort), **U4**, **U9**; **093 U1 + U2**;
   **091 U1–U3**.
2. **091** rest (U4, U5, U7; U6 optional), then **093** rest, then **092** (U1 first; D
   backslash → the recommendation), then **095** U1–U3, U5, U7, U8.
3. **132 P4**: one schema, no migrations. After it lands, tell the other lanes, because it
   ends the migration-renumbering rule.
4. **094** in S slices; drop U8.
5. **128** rewritten small: A1.3 and B2, plus the AGENTS.md section. Delete the rest as obsolete.
6. **135**: P0 deprecated-API sweep and its gate. It touches files everywhere, so run it when
   the other lanes are between landings and land it in one push. Then P1–P5 and P8. P6 and P7
   (high risk) go last.

### L7 — Editor · port 5217 (Platform half)

Owns the Editor repo. On the Platform side it owns `features/editor/**`,
`features/git/utils/diff-*`, and `hooks/use-diff-panes.ts`.

1. **E050** rows, cheapest first: 2, 11 (with **071**'s retry in `syntaxController.ts`), 9, 7,
   5-rest, 8 (with **130** P5 item 8 `onDidScroll`), 4 (with 130 item 10 theme keys), 10.
2. **130 P3** `getStackedRows`.
3. The whole-document `commandDocumentText` copy (new backlog entry from W0).
4. **E020** cursor jump history, then **E021** unit 1 (multi-selection copy).
5. **153** P1 (exit notification), then P2–P3 with D1–D3 as recommended.
6. **099** diff-source fix only.
7. **E053** fade, then **E006** step 7 (position metadata). E006's deleted-anchor behaviour
   change has no recommendation, so it is a hard stop: ask before building it.

### L8 — workbench and agent advantage · port 5218

Owns `apps/web/src/keymap/**`, `client-core/src/commands/**`, `features/workbench`, the markdown
preview, `use-attach-to-composer.ts` (moved to `lib/`).

1. **080** U1–U5 (VS Code mode needs a binding for `Mod+1–3` now that groups exist; take VS
   Code's).
2. **139/140 P1**: move the attach hook to `lib/`, once.
3. **140** P2 and P3. P4 and P5 wait on 087, so park them.
4. **139** research, then P2–P6 with D1–D4 as recommended.
5. **108 Phase 1** markdown preview (1a → 1b → 1c ‖ 1d). Phase 2 needs 111, so park it.

### L9 — 126 git and worktree stream · port 5219

Owns `apps/server/src/git/**`, the worktree lifecycle, `features/git/**` (except the diff files L7 owns).

EXT-15 submodules, EXT-14 fast-forward pull, EXT-18 branch drift, LIFE-14 (server side), EXT-01
forges, EXT-03 clone/publish, EXT-04 setup scripts (trust model as recommended), EXT-02 PR
workspace (after L8's 139 research), LIFE-06 auto-settle, EXT-12 with the LIFE-12 cleanup,
INTERACTION-13 worktree prep (hand it to L2 once it lands). Each row closes with its scenario.

## Parked (not in this wave)

| Plan                                                                   | Why                                                                               |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| 087, 088, 140 P4–P5                                                    | MCP and native code intelligence: XL and security-sensitive; research spike first |
| 099 runtime, 122, E025–E028                                            | Plugin/document runtime touches every package; needs its own wave after 087       |
| 110, 111, 112, E015, 108 P2–3                                          | Research with no scope yet                                                        |
| 114 Polaron                                                            | Needs a go/no-go; conflicts with desktop work in 132/149                          |
| 143, 154 P7                                                            | Phone direction needs a conversation first                                        |
| 144                                                                    | Waits on 145, 148 and 087                                                         |
| 155, 156                                                               | Placeholders                                                                      |
| 141 P5, 126 RUNTIME-08                                                 | Spends account credit                                                             |
| 126 RUNTIME-02, EXT-07, EXT-08, EXT-09, EXT-16, EXT-10, INTERACTION-12 | XL, need accounts or 143/144                                                      |
| 105 P4                                                                 | Needs a mesh feature                                                              |
| E009–E014, E016, E022–E024, E029, E052, E021 rest, E030                | Measured no-go, low value now, or P3                                              |

## Running it

Start W0 and let it push. Then start L2, L3, L5, L6, L7 and L9. Start L1, L4 and L8 once Plan
165 has landed on main. Each lane's prompt names its lane and queue and points back here.
