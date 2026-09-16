import { defaultSettingsDocument } from '@workspace/contracts'
import { useEffect, useState } from 'react'

import { Dialog } from '@/components/dialog'
import { Spinner } from '@/components/spinner'
import type { EditTextRequest } from '@/host/providers/actions-context'
import { useEditorLifetime } from '@/settings/hooks/use-editor-lifetime'
import type { Theme } from '@/theme/utils/theme'

/**
 * Shows the registry defaults in the host editor. Whatever comes back is
 * dropped: the document is generated, and there is no file it could be saved to.
 */
export function DefaultsViewer({
  editText,
  theme,
  onClose,
}: {
  readonly editText: (request: EditTextRequest) => Promise<string | null>
  readonly theme: Theme
  readonly onClose: () => void
}) {
  const lifetime = useEditorLifetime(onClose)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const signal = lifetime.signal
    editText({ text: defaultSettingsDocument(), filename: 'settings-defaults.jsonc', signal })
      .then(() => {
        if (!signal.aborted) lifetime.close()
      })
      .catch((cause: unknown) => {
        if (signal.aborted) return
        setError(cause instanceof Error ? cause.message : 'The editor could not be opened.')
      })
  }, [editText, lifetime])

  return (
    <Dialog title='Default settings · read-only' theme={theme} onClose={lifetime.close}>
      {error ? (
        <text fg={theme.destructive}>{error}</text>
      ) : (
        <box flexDirection='row' gap={1}>
          <Spinner theme={theme} />
          <text fg={theme.foreground}>
            Waiting for editor… edits to this document are discarded.
          </text>
        </box>
      )}
    </Dialog>
  )
}
