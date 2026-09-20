import { assignRef } from '@workspace/ui/lib/assign-ref'
import { FileTypeIcon } from '@/components/file-type-icon'
import type { DraggableAttributes, DraggableSyntheticListeners } from '@dnd-kit/core'
import { useCallback, type CSSProperties, type Ref } from 'react'

import { useEditorTabIntentPrefetch } from '@/features/workspace/hooks/use-tab-intent-prefetch'
import type { EditorTabCloseTarget } from '@/features/workspace/utils/tab-close-targets'
import type { EditorTabModel } from '@/features/workspace/utils/tab-types'
import { useEditorTabActions } from '@/features/editor/hooks/use-editor-tab-actions'
import { EditorTabMenu } from '@/features/workbench/components/editor-tab-menu'
import { TabTrailingSlot } from '@/features/workbench/components/tab-trailing-slot'
import { barTabClassName } from '@workspace/ui/patterns/bar-tabs'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { tabContentKey } from '@/lib/documents/utils/tabs'
import { Shimmer } from '@workspace/ui/components/shimmer'
import { cn } from '@workspace/ui/lib/utils'
import { LockSimpleIcon } from '@phosphor-icons/react'
import { useUnavailableEnvironment } from '@/lib/environments/hooks/use-unavailable-environment'

export function EditorTabButton({
  closeTargets,
  dirty,
  dragAttributes,
  dragListeners,
  dragging = false,
  dragNodeRef,
  dragStyle,
  loading,
  tab,
}: {
  readonly closeTargets: readonly EditorTabCloseTarget[]
  readonly dirty: boolean
  readonly dragAttributes?: DraggableAttributes
  readonly dragListeners?: DraggableSyntheticListeners
  readonly dragging?: boolean
  readonly dragNodeRef?: Ref<HTMLButtonElement>
  readonly dragStyle?: CSSProperties
  readonly loading: boolean
  readonly tab: EditorTabModel
}) {
  const unavailable = useUnavailableEnvironment()
  const intentPrefetchRef = useEditorTabIntentPrefetch(tab)
  const { requestCloseTab, selectTab } = useEditorTabActions()
  // Stable ref composition keeps Foresight and DnD from re-registering on every render.
  const buttonRef = useCallback(
    (node: HTMLButtonElement | null) => {
      intentPrefetchRef(node)
      assignRef(dragNodeRef, node)
    },
    [dragNodeRef, intentPrefetchRef],
  )

  function handleSelectTab() {
    selectTab(tab.id)
  }

  function closeTab() {
    requestCloseTab(tab.id)
  }

  // Raw <button>: spreads dnd-kit drag listeners and needs role='tab'; Button offers neither.
  const trigger = (
    <button
      {...dragAttributes}
      {...dragListeners}
      aria-busy={loading || undefined}
      aria-selected={tab.active}
      className={barTabClassName(
        tab.active,
        cn(
          'group/proof-tab focus-ring-inset max-w-48 min-w-0 cursor-grab touch-none text-left outline-none active:cursor-grabbing',
          dragging && 'relative z-10 text-muted-foreground text-2xs',
        ),
      )}
      data-editor-tab-id={tab.id}
      data-editor-tab-key={tabContentKey(tab.content)}
      data-editor-tab-loading={loading || undefined}
      // copyPath resolves to the source file, which a diff tab shares with the file tab.
      data-editor-tab-path={tabFileResource(tab.content)?.path}
      draggable={false}
      ref={buttonRef}
      role='tab'
      style={dragStyle}
      title={
        unavailable
          ? `${tab.title} (read only; ${unavailable.label ?? unavailable.name} is unreachable)`
          : tab.title
      }
      type='button'
      onClick={handleSelectTab}
    >
      <FileTypeIcon className='size-(--icon-size-sm) shrink-0 object-contain' icon={tab.icon} />
      {editorTabTitle(tab, loading)}
      {unavailable ? (
        <LockSimpleIcon
          aria-label='Read only'
          className='text-warning size-(--icon-size-sm) shrink-0'
        />
      ) : null}
      <TabTrailingSlot
        active={tab.active}
        dirty={dirty}
        orientation='horizontal'
        title={tab.title}
        onClose={closeTab}
      />
    </button>
  )

  return <EditorTabMenu closeTargets={closeTargets} tab={tab} trigger={trigger} />
}

function editorTabTitle(tab: EditorTabModel, loading: boolean) {
  return (
    <span className='flex min-w-0 flex-1 items-baseline gap-1 overflow-hidden whitespace-nowrap'>
      {loading ? (
        <Shimmer className='min-w-0 flex-1 truncate'>{tab.name}</Shimmer>
      ) : (
        <span className='min-w-0 flex-1 truncate'>{tab.name}</span>
      )}
      {tab.diffSuffix ? (
        <span
          aria-hidden='true'
          className={cn(
            // Yields space before the filename does: a tab is 144px wide and
            // `(b25d374 *M)` alone nearly fills it, so a `shrink-0` suffix
            // truncated the name away entirely.
            'min-w-0 shrink truncate text-xs leading-none font-semibold tabular-nums',
            tab.diffStatus?.className ?? 'text-muted-foreground',
          )}
          title={tab.diffStatus?.title}
        >
          {tab.diffSuffix}
        </span>
      ) : null}
    </span>
  )
}
