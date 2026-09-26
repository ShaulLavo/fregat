import { useEffect } from 'react'
import type { SpellcheckService } from '@singapore-editor/spellcheck'

import { useSettingValue } from '@/hooks/use-setting-value'

/** Hands the merged dictionary to the page's spellcheck; `false` entries un-accept a word. */
export function useSpellcheckDictionary(service: SpellcheckService) {
  const words = useSettingValue('spellcheck.words')

  useEffect(() => {
    service.setAcceptedWords(
      Object.entries(words).flatMap(([word, accepted]) => (accepted ? [word] : [])),
    )
  }, [service, words])
}
