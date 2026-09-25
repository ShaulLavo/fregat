# Pull request badge delivery (completion wave, lane L5)

LIFE-14's client half. The server half (sync reactor, `worktree.pull-request-synced`, fake gh) is
recorded in [repository delivery](repository-delivery.md).

## Row badge

The rail row reads `session.worktree.pullRequest` from the shell projection it already holds; no
row queries anything. `pullRequestBadge` in `packages/client-core/src/chat/worktrees/pull-request.ts`
turns the worktree's answer into one badge for both rails:

| Worktree answer             | Web badge                                    | TUI description    |
| --------------------------- | -------------------------------------------- | ------------------ |
| `found`, open               | pull request glyph, `text-success`, `#N`     | `PR #N open · …`   |
| `found`, open and draft     | dashed circle, `text-muted-foreground`, `#N` | `PR #N draft · …`  |
| `found`, merged             | merge glyph, `text-info`, `#N`               | `PR #N merged · …` |
| `found`, closed             | crossed circle, `text-destructive`, `#N`     | `PR #N closed · …` |
| `unknown`                   | pull request glyph, muted, `?`               | `PR unknown · …`   |
| `none`, `unsupported`, null | nothing                                      | nothing            |

The badge sits on the title line before the time, as upstream's does. Its `title` and accessible
name are `Pull request #N · State: title`; `unknown` reads "Pull request unknown. The last lookup
failed." and is never shown as no pull request. Clicking a found badge opens the URL with
`window.open(…, 'noopener,noreferrer')`, the app's existing external-open call; the click and
pointer-down stop at the badge, so the row neither activates nor starts a drag. The row is a
`<button>` and an anchor nested in a button is invalid markup, so the badge is a `span role="link"`.

The badge carries a native `title` and no `data-tooltip`: the row already has a native `title`,
and a shared-layer tooltip inside it would draw two popups. No Tooltip root per row is mounted.

The TUI rail puts the summary ahead of the branch, because a `worktree/<uuid>` branch fills the
rail's width on its own.

## Long branch labels

A `worktree/<uuid>` branch widened the rail by 35px (scrollWidth 335 against 300). The chip line
is a flex child of the row's start-aligned column, so it sized to its content and `min-w-0` never
capped it; `w-full` on that line lets the chip truncate, and the chip's `title` recovers the
branch. The scenario asserts `scrollWidth <= clientWidth` on the rail.

## Evidence

- Scenario `scripts/agent/scenarios/session-pull-request-badge.ts`, run
  `/work/tmp/fregat-evidence/20260925T140706Z-scenario-session-pull-request-badge/`: six sessions
  in their own worktrees against a fake gh show open, draft, merged, closed and unknown badges and
  no badge for none; clicking the open badge opens its pull request and leaves the row unselected;
  the rail does not scroll sideways. Screenshots read.
- DOM tests `apps/web/src/features/chat-mode/components/tests/session-pull-request-badge.test.tsx`
  and the TUI rail test.
