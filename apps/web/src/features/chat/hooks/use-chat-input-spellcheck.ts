import type { Editor } from '@singapore-editor/core/editor'
import { createSpellcheckPlugin, SpellcheckService } from '@singapore-editor/spellcheck'
import { useEffect, useState } from 'react'

import { useSettingValue } from '@/hooks/use-setting-value'

/** One spellcheck worker for the composer, plugged into whichever editor it currently shows. */
export function useChatInputSpellcheck(editor: Editor | null) {
  const enabled = useSettingValue('chat.spellcheck')
  const [service, setService] = useState<SpellcheckService | null>(null)

  useEffect(() => {
    if (!enabled) return

    const created = new SpellcheckService()
    setService(created)
    return () => {
      setService(null)
      created.dispose()
    }
  }, [enabled])

  useEffect(() => {
    if (!editor || !service) return

    // Chips are inline replacements, which the checker already leaves alone.
    const registration = editor.addPlugin(createSpellcheckPlugin({ service }))
    return () => registration.dispose()
  }, [editor, service])
}
