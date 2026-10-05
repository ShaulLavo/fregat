import { Button } from '@workspace/ui/components/button'
import { useEditorCommands } from '@/features/editor/hooks/use-editor-commands'
import { useEditorTabIntentPrefetch } from '@/features/workspace/hooks/use-tab-intent-prefetch'
import { tabId } from '@/lib/documents/utils/identity'
import type { FilesystemPath } from '@/lib/documents/utils/types'
import { testTabContent } from './document-targets'

export function RetentionAcceptanceIntent({
  path,
  slot,
}: {
  readonly path: FilesystemPath
  readonly slot: string
}) {
  const commands = useEditorCommands()
  const ref = useEditorTabIntentPrefetch({
    active: false,
    id: tabId(`retention-acceptance-${slot}`),
    content: testTabContent(path),
  })
  return (
    <Button
      ref={ref}
      data-retention-acceptance-intent={slot}
      onClick={() => void commands.openFileSurface(path)}
    >
      Open {slot}
    </Button>
  )
}
