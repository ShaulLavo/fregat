import type { ResolvedMenuInvocation, ResolvedMenuItem } from '@/keymap/menus/utils/resolve'
import {
  ContextMenuCheckboxItem,
  ContextMenuItem,
  ContextMenuRadioGroup,
  ContextMenuRadioItem,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
} from '@workspace/ui/components/context-menu'

import { MenuSection } from './section'

export function MenuItemRow({
  item,
  onInvoke,
}: {
  readonly item: ResolvedMenuItem
  readonly onInvoke: (
    item: ResolvedMenuItem,
    value?: string,
    invocation?: ResolvedMenuInvocation,
  ) => void
}) {
  if (item.kind === 'submenu') {
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger disabled={item.disabled}>
          {item.icon ? <item.icon /> : null}
          <span>{item.label}</span>
        </ContextMenuSubTrigger>
        <ContextMenuSubContent>
          {item.sections.map((entry, index) => (
            <MenuSection index={index} key={entry.id} onInvoke={onInvoke} section={entry} />
          ))}
        </ContextMenuSubContent>
      </ContextMenuSub>
    )
  }

  if (item.kind === 'checkbox') {
    return (
      <ContextMenuCheckboxItem
        checked={item.checked}
        disabled={item.disabled}
        onClickCapture={() => {
          const checked = !item.checked
          item.toggle(checked)
          onInvoke(item, String(checked))
        }}
      >
        {item.icon ? <item.icon /> : null}
        <span>{item.label}</span>
      </ContextMenuCheckboxItem>
    )
  }

  if (item.kind === 'radio-group') {
    return (
      <ContextMenuRadioGroup value={item.value}>
        {item.options.map((option) => (
          <ContextMenuRadioItem
            disabled={option.disabled}
            key={option.value}
            value={option.value}
            onClickCapture={() => {
              const invocation = item.select(option.value)
              onInvoke(item, option.value, invocation)
            }}
          >
            {option.icon ? <option.icon /> : null}
            <span>{option.label}</span>
          </ContextMenuRadioItem>
        ))}
      </ContextMenuRadioGroup>
    )
  }

  return (
    <ContextMenuItem
      disabled={item.disabled}
      onClickCapture={() => {
        // A focus-taking item runs once the menu has closed; the surface owns that.
        const invocation = item.takesFocus ? undefined : item.run()
        onInvoke(item, undefined, invocation)
      }}
      variant={item.destructive ? 'destructive' : 'default'}
    >
      {item.icon ? <item.icon /> : null}
      <span className={item.mono ? 'font-mono' : undefined}>{item.label}</span>
      {item.trailing ? <ContextMenuShortcut>{item.trailing}</ContextMenuShortcut> : null}
    </ContextMenuItem>
  )
}
