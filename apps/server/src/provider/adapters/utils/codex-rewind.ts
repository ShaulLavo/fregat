import * as v from 'valibot'
import { createInternalError } from '../../../observability/structured-errors'

type CodexRequest = (method: string, params: Record<string, unknown>) => Promise<unknown>

const turnPageSchema = v.object({
  data: v.array(v.object({ id: v.pipe(v.string(), v.nonEmpty()) })),
  nextCursor: v.nullish(v.string()),
})
const revertedThreadSchema = v.object({ thread: v.object({ id: v.string() }) })

/** The native turn `index` places back from the newest (0 is the newest), or null past the start. */
export async function codexTurnFromEnd({
  threadId,
  index,
  request,
}: {
  readonly threadId: string
  readonly index: number
  readonly request: CodexRequest
}) {
  let remaining = index + 1
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
    if (target) return target.id
    remaining -= page.data.length
    if (page.data.length === 0 || !page.nextCursor || seen.has(page.nextCursor)) return null
    seen.add(page.nextCursor)
    cursor = page.nextCursor
  }
  return null
}

export async function prepareCodexRewind({
  threadId,
  numTurns,
  request,
}: {
  readonly threadId: string
  readonly numTurns: number
  readonly request: CodexRequest
}) {
  if (numTurns < 1) throw createInternalError('Codex rewind requires at least one native turn.')
  const beforeTurnId = await codexTurnFromEnd({ threadId, index: numTurns - 1, request })
  if (!beforeTurnId)
    throw createInternalError('Codex rewind boundary is unavailable in the native history.')

  return async () => {
    const result = v.parse(
      revertedThreadSchema,
      await request('thread/revert', { threadId, beforeTurnId }),
    )
    if (result.thread.id !== threadId)
      throw createInternalError('Codex rewind returned another thread.')
  }
}
