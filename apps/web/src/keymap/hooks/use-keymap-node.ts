import { useEffectEvent, useLayoutEffect, useState } from 'react'
import type { CommandHandler, FocusNode, FocusNodeContext } from '@fregat/hotkeys'
import { useCommand } from '@/keymap/hooks/use-command'
import type { FocusArea } from '@/lib/focus/state/service'

export function useKeymapNode(options: {
  readonly parent?: FocusNode<KeyboardEvent> | (() => FocusNode<KeyboardEvent>)
  readonly area: FocusArea
  readonly context: FocusNodeContext
  readonly element?: () => Element | null
  readonly commands: Readonly<Record<string, CommandHandler<KeyboardEvent>>>
}) {
  const { keymap } = useCommand()
  const [element, setElement] = useState<Element | null>(null)
  const context = useEffectEvent(() => options.context)
  const run = useEffectEvent(
    (command: string, event: Parameters<CommandHandler<KeyboardEvent>>[0]) => {
      const handler = options.commands[command]
      if (!handler) return false
      return handler(event)
    },
  )
  const readParent = useEffectEvent(() =>
    typeof options.parent === 'function'
      ? options.parent()
      : (options.parent ?? keymap.parentFor(options.area)),
  )
  const readElement = useEffectEvent(() => options.element?.() ?? element)
  const commandIds = Object.keys(options.commands).join('\n')
  useLayoutEffect(() => {
    const commands = Object.fromEntries(
      commandIds
        .split('\n')
        .filter(Boolean)
        .map((id) => [id, (event: Parameters<CommandHandler<KeyboardEvent>>[0]) => run(id, event)]),
    )
    return keymap.registerNode({ parent: readParent, context, element: readElement, commands })
  }, [commandIds, element, keymap, options.area])
  return setElement
}
