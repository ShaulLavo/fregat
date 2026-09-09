import * as v from 'valibot'
import { appendTerminalContextsToPrompt } from '@workspace/client-core/chat/terminal-context'

export const promptElementSchema = v.object({
  id: v.string(),
  start: v.number(),
  end: v.number(),
  label: v.string(),
  text: v.string(),
})
export const terminalContextSchema = v.object({
  source: v.string(),
  lineStart: v.number(),
  lineEnd: v.number(),
  text: v.string(),
})
export type PromptElement = v.InferOutput<typeof promptElementSchema>
export type PromptContent = {
  readonly text: string
  readonly elements?: readonly PromptElement[]
  readonly terminalContexts?: readonly v.InferOutput<typeof terminalContextSchema>[]
}

export function expandedPrompt(draft: PromptContent) {
  let text = draft.text
  const elements = (draft.elements ?? []).toSorted((a, b) => b.start - a.start)
  for (const element of elements) {
    if (text.slice(element.start, element.end) !== element.label) continue
    text = text.slice(0, element.start) + element.text + text.slice(element.end)
  }
  return appendTerminalContextsToPrompt(text, draft.terminalContexts ?? [])
}

export function largePaste(text: string) {
  return text.length > 1000 || text.split('\n').length > 10
}

export function imagePastePath(text: string) {
  const value = text.trim().replace(/^['"]|['"]$/g, '')
  if (value.includes('\n') || !/\.(png|jpe?g|gif|webp)$/i.test(value)) return null
  if (!value.startsWith('/') && !value.startsWith('./') && !value.startsWith('file://')) return null
  if (!value.startsWith('file://')) return value
  try {
    return decodeURIComponent(new URL(value).pathname)
  } catch {
    return null
  }
}

export function removePromptElement(draft: PromptContent, element: PromptElement) {
  const length = element.end - element.start
  return {
    text: draft.text.slice(0, element.start) + draft.text.slice(element.end),
    elements: (draft.elements ?? [])
      .filter((item) => item.id !== element.id)
      .map((item) => {
        if (item.start < element.end) return item
        return { ...item, start: item.start - length, end: item.end - length }
      }),
  }
}
