import { memo } from 'react'
import type { ListRowProps } from '@workspace/ui/patterns/list-row'
import type { WorkspaceSearchQuery } from '@workspace/contracts'
import { SearchFileGroupHeader } from '@/features/search/components/file-group'
import { SearchMatchRow } from '@/features/search/components/match-row'
import { SearchNameMatchRow } from '@/features/search/components/name-match-row'
import { useSearchResultActions } from '@/features/search/hooks/use-result-actions'
import type { SearchResultItem } from '@/features/search/utils/result-items'
import type { MeasurePreviewCell } from '@/features/search/state/preview-budget'

export const SearchResultRow = memo(
  ({
    active,
    rowProps,
    item,
    canReplace,
    compact,
    measurePreviewCell,
    previewMaxLength,
    query,
    replaceQuery,
    replaceText,
    replaceVisible,
  }: {
    rowProps: Omit<ListRowProps, 'ref' | 'as'>
    active: boolean
    item: SearchResultItem
    canReplace?: boolean
    compact?: boolean
    measurePreviewCell?: MeasurePreviewCell
    previewMaxLength?: number
    query: string
    replaceQuery: WorkspaceSearchQuery | null
    replaceText: string
    replaceVisible?: boolean
  }) => {
    const { openMatch, replaceGroup, replaceMatch, selectResult, toggleGroup } =
      useSearchResultActions()

    if (item.type === 'group') {
      return (
        <SearchFileGroupHeader
          active={active}
          rowProps={rowProps}
          canReplace={canReplace}
          compact={compact}
          group={item.group}
          replaceVisible={replaceVisible}
          onReplace={replaceGroup}
          onToggle={() => {
            selectResult(item.id)
            toggleGroup(item.group.path)
          }}
        />
      )
    }
    if (item.type === 'name') {
      return (
        <SearchNameMatchRow
          active={active}
          rowProps={rowProps}
          compact={compact}
          match={item.match}
          measurePreviewCell={measurePreviewCell}
          previewMaxLength={previewMaxLength}
          query={query}
          onOpenMatch={() => {
            selectResult(item.id)
            openMatch(item.match)
          }}
        />
      )
    }

    return (
      <SearchMatchRow
        active={active}
        rowProps={rowProps}
        canReplace={canReplace}
        compact={compact}
        match={item.match}
        measurePreviewCell={measurePreviewCell}
        previewMaxLength={previewMaxLength}
        replaceQuery={replaceQuery}
        replaceText={replaceText}
        replaceVisible={replaceVisible}
        query={query}
        onOpenMatch={() => {
          selectResult(item.id)
          openMatch(item.match)
        }}
        onReplaceMatch={replaceMatch}
      />
    )
  },
)
