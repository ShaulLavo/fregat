import { Popover, PopoverContent, PopoverTrigger } from '@workspace/ui/components/popover'
import { ListRow } from '@workspace/ui/patterns/list-row'
import { useLayoutEffect, useMemo, useRef } from 'react'

import {
  chatInputCommandMenuLoadingLabel,
  groupChatInputCommandItems,
  type ChatInputCommandItem,
  type ChatInputTriggerKind,
} from '@/features/chat/utils/input-logic'
import { ChatInputCommandItemIcon } from './chat-input-command-item-icon'
import { CommandMenuLoading } from '@/features/chat/components/command-menu-loading'

/**
 * Matches the composer's width through the positioner's anchor variables and
 * takes whatever height is left above it. The composer lives in resizable panes
 * that resize constantly, so a fixed cap would either clip the list or float it
 * over the messages.
 */
const MENU_CLASS = 'max-h-(--available-height) w-(--anchor-width) gap-0 overflow-hidden p-0'

export function ChatInputCommandMenu({
  activeItemId,
  emptyLabel,
  isLoading,
  items,
  onActiveItemChange,
  onDismiss,
  onSelect,
  triggerKind,
}: {
  activeItemId: string | null
  emptyLabel: string
  isLoading: boolean
  items: readonly ChatInputCommandItem[]
  onActiveItemChange: (itemId: string | null) => void
  onDismiss: () => void
  onSelect: (item: ChatInputCommandItem) => void
  triggerKind: ChatInputTriggerKind
}) {
  const listRef = useRef<HTMLDivElement>(null)
  const groups = useMemo(() => groupChatInputCommandItems(items, triggerKind), [items, triggerKind])

  useLayoutEffect(() => {
    if (!activeItemId || !listRef.current) return

    const activeItem = listRef.current.querySelector<HTMLElement>(
      `[data-chat-input-command-item-id="${CSS.escape(activeItemId)}"]`,
    )
    activeItem?.scrollIntoView({ block: 'nearest' })
  }, [activeItemId])

  function handleOpenChange(nextOpen: boolean) {
    if (nextOpen) return

    onDismiss()
  }

  return (
    <Popover open onOpenChange={handleOpenChange}>
      {/* Anchor only. The composer has no button to hang the menu off, and the
          caret must never leave the editor, so the trigger is an inert strip
          across the top of the composer. */}
      <PopoverTrigger
        aria-hidden
        className='pointer-events-none absolute inset-x-0 top-0 h-0'
        nativeButton={false}
        render={<span />}
        tabIndex={-1}
      />
      <PopoverContent
        align='start'
        className={MENU_CLASS}
        finalFocus={false}
        initialFocus={false}
        role='listbox'
        side='top'
      >
        {items.length > 0 ? (
          <div ref={listRef} className='app-scrollbar-thin min-h-0 flex-1 overflow-y-auto py-1'>
            {groups.map((group, groupIndex) => (
              <div key={group.id}>
                {groupIndex > 0 ? <div className='bg-border my-0.5 h-px' /> : null}
                {group.label ? (
                  <div className='text-muted-foreground section-label px-(--density-command-heading-padding-x) pt-(--density-command-heading-padding-top) pb-1'>
                    {group.label}
                  </div>
                ) : null}
                {group.items.map((item) => (
                  <ListRow
                    as='button'
                    selected={activeItemId === item.id}
                    className='w-full min-w-0 cursor-pointer gap-(--density-control-gap) text-left select-none'
                    data-chat-input-command-item-id={item.id}
                    key={item.id}
                    role='option'
                    title={`${item.label} — ${item.description}`}
                    type='button'
                    onClick={() => onSelect(item)}
                    onMouseDown={(event) => event.preventDefault()}
                    onMouseMove={() => {
                      if (activeItemId !== item.id) onActiveItemChange(item.id)
                    }}
                  >
                    <ChatInputCommandItemIcon item={item} />
                    <span className='flex min-w-0 flex-1 items-center gap-2'>
                      <span className='shrink-0 font-medium'>{item.label}</span>
                      <span className='text-muted-foreground min-w-0 flex-1 truncate text-xs'>
                        {item.description}
                      </span>
                    </span>
                  </ListRow>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <div className='px-(--density-command-item-padding-x) py-(--density-command-item-padding-y)'>
            {triggerKind === 'slash-command' ? (
              <div className='text-muted-foreground section-label pb-1'>Built-in</div>
            ) : null}
            {isLoading ? (
              <CommandMenuLoading label={chatInputCommandMenuLoadingLabel(triggerKind)} />
            ) : (
              <p className='text-muted-foreground text-xs'>{emptyLabel}</p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
