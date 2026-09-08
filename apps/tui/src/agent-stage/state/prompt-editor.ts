import type { SyntaxStyle, TextareaRenderable } from '@opentui/core'
import type { PromptContent, PromptElement } from '@/agent-stage/utils/prompt'

export function createPromptEditor(input: TextareaRenderable, syntax: SyntaxStyle) {
  const typeId = input.extmarks.registerType('prompt-paste')
  const referenceType = input.extmarks.registerType('prompt-reference')
  input.gotoBufferEnd()
  const parts = new Map<string, PromptElement>()
  let synchronizing = false
  function read() {
    const elements: PromptElement[] = []
    // OpenTUI undo restores marks but does not rebuild its per-type index.
    for (const mark of input.extmarks.getAll()) {
      if (mark.typeId !== typeId) continue
      const part = parts.get(String(mark.data))
      if (!part) continue
      const start = input.getTextRange(0, mark.start).length
      const end = start + input.getTextRange(mark.start, mark.end).length
      elements.push({ ...part, start, end })
    }
    return { text: input.plainText, elements }
  }
  function createMark(element: PromptElement, start: number, end: number) {
    parts.set(element.id, element)
    input.extmarks.create({
      start,
      end,
      virtual: true,
      typeId,
      data: element.id,
      styleId: syntax.getStyleId('prompt-part') ?? undefined,
    })
  }
  function decorate() {
    for (const mark of input.extmarks.getAll()) {
      if (mark.typeId === referenceType) input.extmarks.delete(mark.id)
    }
    const text = input.plainText
    for (const match of text.matchAll(/(?:^|\s)([@/$](?:"[^"\n]+"|[\w./-]+))(?=\s)/g)) {
      const token = match[1]
      const start = nativeOffset(text.slice(0, match.index + match[0].length - token.length))
      input.extmarks.create({
        start,
        end: start + nativeOffset(token),
        typeId: referenceType,
        styleId: syntax.getStyleId('prompt-reference') ?? undefined,
      })
    }
  }
  return {
    read,
    decorate,
    get synchronizing() {
      return synchronizing
    },
    sync(draft: PromptContent) {
      if (
        input.plainText === draft.text &&
        JSON.stringify(read().elements) === JSON.stringify(draft.elements ?? [])
      )
        return
      synchronizing = true
      try {
        input.setText(draft.text)
        for (const part of draft.elements ?? []) {
          const start = nativeOffset(draft.text.slice(0, part.start))
          createMark(part, start, start + nativeOffset(part.label))
        }
        input.gotoBufferEnd()
        decorate()
      } finally {
        synchronizing = false
      }
    },
    paste(text: string) {
      synchronizing = true
      try {
        input.deleteSelection()
        const start = input.cursorOffset
        const label = `[Paste ${text.split('\n').length} lines · ${text.length} chars]`
        input.insertText(label)
        const element = { id: crypto.randomUUID(), start: 0, end: 0, label, text }
        createMark(element, start, input.cursorOffset)
      } finally {
        synchronizing = false
      }
      return read()
    },
  }
}

function nativeOffset(text: string) {
  const lines = text.split('\n')
  return lines.reduce((sum, line) => sum + Bun.stringWidth(line), lines.length - 1)
}
