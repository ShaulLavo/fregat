import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext'
import { modelOptionDescriptors } from '@workspace/client-core/chat/providers/options'
import { useEffect } from 'react'

import { useModelPicker } from '@/features/chat/hooks/use-model-picker'
import { clearUltrathink, paintUltrathink } from '@/features/chat/state/ultrathink-highlights'

/** Colours the word "ultrathink" while the model lets it switch the effort. */
export function ChatInputUltrathinkPlugin() {
  const [editor] = useLexicalComposerContext()
  const { modelSelection, provider } = useModelPicker()
  const model = provider?.models.find((candidate) => candidate.slug === modelSelection?.model)
  const effort = model
    ? modelOptionDescriptors(model).find((descriptor) => descriptor.type === 'select')
    : undefined
  const enabled = Boolean(effort?.type === 'select' && effort.promptInjectedValues?.length)

  useEffect(() => {
    let root = editor.getRootElement()
    const paint = () => {
      if (root) paintUltrathink(root, enabled)
    }
    paint()
    const removeRoot = editor.registerRootListener((next, previous) => {
      if (previous) clearUltrathink(previous)
      root = next
      paint()
    })
    const removeUpdate = editor.registerUpdateListener(paint)

    return () => {
      removeRoot()
      removeUpdate()
      if (root) clearUltrathink(root)
    }
  }, [editor, enabled])

  return null
}
