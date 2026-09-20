import type { ReactEditorController } from '@singapore-editor/react'

import { useFocusTarget } from '@/lib/focus/hooks/use-target'
import type { FocusTargetId } from '@/lib/focus/state/service'

export function useEditorFocusTarget({
  controller,
  id,
  writable,
}: {
  controller: ReactEditorController
  id: Extract<FocusTargetId, { kind: 'editor' }>
  writable: boolean
}) {
  return useFocusTarget<HTMLDivElement>({
    area: 'editor',
    capabilities: {
      editor: {
        dispatch: controller.commands.dispatchCommand,
        getInputElement: () => controller.getEditor()?.getInputElement() ?? null,
        readKeymapContext: () => controller.getEditor()?.getKeymapContext() ?? null,
        writable,
      },
    },
    id,
    onIntent: (intent) => {
      if (intent !== 'focus') return false
      controller.commands.focus()
      return true
    },
  })
}
