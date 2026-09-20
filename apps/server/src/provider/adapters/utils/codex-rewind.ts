import * as v from 'valibot'
import { createInternalError } from '../../../observability/structured-errors'

const turnPageSchema = v.object({
  data: v.array(v.object({ id: v.pipe(v.string(), v.nonEmpty()) })),
  nextCursor: v.nullish(v.string()),
})
const revertedThreadSchema = v.object({ thread: v.object({ id: v.string() }) })

export async function prepareCodexRewind({
  threadId,
  numTurns,
  request,
}: {
  readonly threadId: string
  readonly numTurns: number
  readonly request: (method: string, params: Record<string, unknown>) => Promise<unknown>
}) {
  let remaining = numTurns
  let cursor: string | null = null
  const seen = new Set<string>()
  while (remaining > 0) {
    const page: v.InferOutput<typeof turnPageSchema> = v.parse(
      turnPageSchema,
      await request('thread/turns/list', {
        threadId,
        sortDirection: 'desc',
        itemsView: 'notLoaded',
        limit: Math.min(remaining, 100),
        ...(cursor ? { cursor } : {}),
      }),
    )
    const target = page.data[remaining - 1]
    if (target) {
      return async () => {
        const result = v.parse(
          revertedThreadSchema,
          await request('thread/revert', { threadId, beforeTurnId: target.id }),
        )
        if (result.thread.id !== threadId)
          throw createInternalError('Codex rewind returned another thread.')
      }
    }
    remaining -= page.data.length
    if (page.data.length === 0 || !page.nextCursor || seen.has(page.nextCursor))
      throw createInternalError('Codex rewind boundary is unavailable in the native history.')
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
  throw createInternalError('Codex rewind requires at least one native turn.')
}
