import { useRef } from 'react'
import type { SessionRailGroup } from '@workspace/client-core/chat/rail/model'

import { ProjectMenu } from '@/features/chat-mode/components/project-menu'
import { useListContextMenu } from '@/keymap/menus/hooks/use-list-context-menu'

export function ProjectMenuHarness({ group }: { readonly group: SessionRailGroup }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const menu = useListContextMenu<string>({
    containerRef,
    isTargetPresent: (target) => target === group.key,
  })
  return (
    <div ref={containerRef} tabIndex={0} {...menu.containerProps}>
      <button onContextMenu={(event) => menu.openAtEvent(group.key, event)}>Project actions</button>
      {menu.anchor ? (
        <ProjectMenu
          group={group}
          anchor={menu.anchor}
          onOpenChange={menu.onOpenChange}
          returnFocusTo={menu.returnFocusTo}
        />
      ) : null}
    </div>
  )
}
