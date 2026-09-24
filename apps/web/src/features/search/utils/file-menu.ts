import { CrosshairIcon } from '@phosphor-icons/react'

import { copyPathSection } from '@/keymap/menus/utils/copy-path-section'
import { actionItem, section, type Menu } from '@/keymap/menus/utils/model'
import { openFileItem } from '@/keymap/menus/utils/open-file-item'
import type { SearchResultOpenTarget } from '@/features/search/utils/result-view-model'
import type { SearchResultItem } from '@/features/search/utils/result-items'
import type { WorkspaceSearchFileGroup } from '@/features/search/state/buffer-state'

export type SearchFileMenuContext = {
  readonly copyPath: (value: string, label: string) => void
  readonly open: (target: SearchResultOpenTarget) => void
  /** The path the search tree shows, relative to its root. */
  readonly relativePath: string
  readonly target: SearchResultOpenTarget
}

/**
 * The file actions a search result shares with Files and Git. A match row adds
 * Open Match, which lands on its line and column; every row can open the file.
 * Search never mutates the file from here: replace keeps its own row button.
 */
export function searchFileMenu(context: SearchFileMenuContext): Menu {
  const { path } = context.target
  return [
    section('open', [
      context.target.match &&
        actionItem({
          icon: CrosshairIcon,
          id: 'openMatch',
          label: 'Open Match',
          run: () => context.open(context.target),
          takesFocus: true,
        }),
      openFileItem({ run: () => context.open({ match: null, path }), takesFocus: true }),
    ]),
    copyPathSection({ copyPath: context.copyPath, path, relativePath: context.relativePath }),
  ]
}

/** What a sidebar result row opens and names: a match keeps its line, a file heading its file. */
export function searchItemMenuTarget(
  item: SearchResultItem,
  groups: readonly WorkspaceSearchFileGroup[],
): { readonly relativePath: string; readonly target: SearchResultOpenTarget } {
  if (item.type !== 'match')
    return { relativePath: item.group.pathLabel, target: { match: null, path: item.group.path } }

  const group = groups.find((candidate) => candidate.path === item.groupPath)
  return {
    relativePath: group?.pathLabel ?? item.match.path,
    target: { match: item.match, path: item.match.path },
  }
}
