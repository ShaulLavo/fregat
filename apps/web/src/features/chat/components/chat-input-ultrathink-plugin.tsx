import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { modelOptionDescriptors } from '@workspace/client-core/chat/providers/options'
import { useEffect } from 'react'

import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import { registerUltrathinkEntity } from '@/features/chat/utils/ultrathink-node'

/** Paints the word "ultrathink" while the model lets it switch the effort. */
export function ChatInputUltrathinkPlugin() {
  const [editor] = useLexicalComposerContext()
  const { modelSelection, provider } = useModelPicker()
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection?.model)
  const effort = model
    ? modelOptionDescriptors(model).find((descriptor) => descriptor.type === 'select')
    : undefined
  const enabled = Boolean(effort?.type === 'select' && effort.promptInjectedValues?.length)

  useEffect(() => registerUltrathinkEntity(editor, enabled), [editor, enabled])

  return null
}
