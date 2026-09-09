import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk'
import * as v from 'valibot'
import { discoveryInputSchema, discoveredSessionsSchema } from './utils/discovery-metadata'
import {
  claudeHistoryMessages,
  historyMessagesSchema,
  sessionHistoryInputSchema,
} from './utils/session-history'

const input = v.parse(
  v.union([sessionHistoryInputSchema, discoveryInputSchema]),
  JSON.parse(await Bun.stdin.text()),
)
const result = 'sessionId' in input ? await readHistory(input) : await discover(input)
await Bun.write(Bun.stdout, JSON.stringify(result))

async function readHistory(input: v.InferOutput<typeof sessionHistoryInputSchema>) {
  const messages = await getSessionMessages(input.sessionId, { dir: input.cwd })
  return v.parse(historyMessagesSchema, claudeHistoryMessages(messages))
}

async function discover(input: v.InferOutput<typeof discoveryInputSchema>) {
  const sessions = await listSessions({
    dir: input.cwd,
    limit: input.limit,
    offset: input.offset,
    includeWorktrees: true,
    includeProgrammatic: false,
  })
  const metadata = sessions.map((session) => ({
    sessionId: session.sessionId,
    cwd: session.cwd ?? null,
    title: session.customTitle?.trim() || session.summary.trim() || 'Claude session',
    sourceUpdatedAt: new Date(session.lastModified).toISOString(),
    gitBranch: session.gitBranch ?? null,
  }))
  return v.parse(discoveredSessionsSchema, metadata)
}
