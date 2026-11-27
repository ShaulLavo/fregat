import { modelOptionDescriptors } from '@workspace/client-core/chat/providers/options'
import { useEffect } from 'react'

import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import { useChatInputEditor } from '@/features/chat/providers/composer-editor-context'
import { createChatInputUltrathinkPlugin } from '@/features/chat/utils/composer-plugins'

/** Paints the word "ultrathink" while the model lets it switch the effort. */
export function ChatInputUltrathinkPlugin() {
  const editor = useChatInputEditor()
  const { modelSelection, provider } = useModelPicker()
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection?.model)
  const effort = model
    ? modelOptionDescriptors(model).find((descriptor) => descriptor.type === 'select')
    : undefined
  const enabled = Boolean(effort?.type === 'select' && effort.promptInjectedValues?.length)

  useEffect(() => {
    if (!editor || !enabled) return
    const disposable = editor.editor.addPlugin(createChatInputUltrathinkPlugin())
    return () => disposable.dispose()
  }, [editor, enabled])

  return null
}
