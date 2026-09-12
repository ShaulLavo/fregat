import { ArrowBendUpLeftIcon, GitDiffIcon, MinusIcon, PlusIcon } from '@phosphor-icons/react'

import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'

import type { PanelSection } from '@/features/git/utils/types'

export type GroupMenuContext = {
  /** Unstage-then-discard for the staged group, a plain discard for the worktree one. */
  readonly discardAll: () => void
  readonly openAllDiffs: () => void
  readonly section: PanelSection
  readonly stageAll: () => void
  readonly unstageAll: () => void
}

/**
 * Every action the group header already exposes on hover, minus the direction
 * that makes no sense for the group: staged rows are never staged again, and
 * worktree rows have nothing to unstage.
 */
export function groupMenu(context: GroupMenuContext): Menu {
  const staged = context.section === 'staged'

  return [
    // Navigation first, matching `git.file` — the destructive bulk actions sit
    // below the rule rather than under the cursor when the menu opens.
    section('open', [
      actionItem({
        icon: GitDiffIcon,
        id: 'openAllDiffs',
        label: 'Open All Diffs',
        run: context.openAllDiffs,
      }),
    ]),
    section('changes', [
      !staged &&
        actionItem({
          icon: PlusIcon,
          id: 'stageAll',
          label: 'Stage All Changes',
          run: context.stageAll,
        }),
      staged &&
        actionItem({
          icon: MinusIcon,
          id: 'unstageAll',
          label: 'Unstage All Changes',
          run: context.unstageAll,
        }),
      actionItem({
        destructive: true,
        icon: ArrowBendUpLeftIcon,
        id: 'discardAll',
        label: discardAllLabel(staged),
        run: context.discardAll,
      }),
    ]),
  ]
}

function discardAllLabel(staged: boolean) {
  if (staged) return 'Discard All Staged Changes'

  return 'Discard All Changes'
}
