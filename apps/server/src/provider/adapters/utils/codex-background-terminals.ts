import * as v from 'valibot'
import { sessionIdentityErrors } from '../../structured-errors'

const backgroundTerminalsSchema = v.object({
  data: v.array(
    v.object({
      itemId: v.string(),
      processId: v.string(),
      command: v.string(),
      cwd: v.string(),
      osPid: v.optional(v.nullable(v.number())),
      cpuPercent: v.optional(v.nullable(v.number())),
      rssKb: v.optional(v.nullable(v.number())),
    }),
  ),
  nextCursor: v.optional(v.nullable(v.string())),
})

export async function hasCodexBackgroundTerminals(input: {
  threadId: string
  deadline: number
  read: (params: { threadId: string; cursor?: string }) => Promise<unknown>
}) {
  let cursor: string | undefined
  const cursors = new Set<string>()
  for (;;) {
    if (Date.now() >= input.deadline) return true
    const result = v.safeParse(
      backgroundTerminalsSchema,
      await input.read({ threadId: input.threadId, cursor }),
    )
    if (!result.success)
      throw sessionIdentityErrors.BACKGROUND_CHECK_FAILED({
        internal: { reason: 'invalid-envelope', issueCount: result.issues.length },
      })
    const page = result.output
    if (page.data.length) return true
    if (!page.nextCursor) return false
    if (cursors.has(page.nextCursor)) return true
    cursors.add(page.nextCursor)
    cursor = page.nextCursor
  }
}
