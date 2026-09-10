import * as v from 'valibot'
import type { FileStorage } from '@/storage/files'
import { createTuiError } from '@/host/utils/structured-errors'

const draftSchema = v.object({
  text: v.string(),
  expected: v.object({ mtimeMs: v.number(), version: v.string() }),
})
export type ViewerDraft = v.InferOutput<typeof draftSchema>

export function createViewerDraftCache(storage: FileStorage, rootPath: string, path: string) {
  const key = `viewer:draft:${JSON.stringify([rootPath, path])}`
  return {
    read(): ViewerDraft | null {
      const text = storage.getItem(key)
      if (text === null) return null
      try {
        return v.parse(draftSchema, JSON.parse(text))
      } catch (cause) {
        throw createTuiError(
          'Saved editor draft could not be read.',
          'Inspect the saved TUI draft before deleting it.',
          cause instanceof Error ? cause : undefined,
        )
      }
    },
    async save(draft: ViewerDraft) {
      storage.setItem(key, JSON.stringify(draft))
      await storage.flush()
    },
    async remove(draft: ViewerDraft | null) {
      if (draft === null) return
      const expected = JSON.stringify(draft)
      storage.updateItem(key, (current) => (current === expected ? null : current))
      await storage.flush()
    },
  }
}
