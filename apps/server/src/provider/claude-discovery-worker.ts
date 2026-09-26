import os from 'node:os'
import path from 'node:path'
import { getSessionMessages, listSessions } from '@anthropic-ai/claude-agent-sdk'
import * as v from 'valibot'
import { discoveryInputSchema, discoveredSessionsSchema } from './utils/discovery-metadata'
import { claudeTranscriptUsage } from './utils/imported-usage'
import { readJsonLines } from './utils/json-lines'
import {
  claudeHistoryMessages,
  historyMessagesSchema,
  sessionHistoryInputSchema,
  sessionUsageInputSchema,
} from './utils/session-history'

const input = v.parse(
  v.union([sessionUsageInputSchema, sessionHistoryInputSchema, discoveryInputSchema]),
  JSON.parse(await Bun.stdin.text()),
)
const result = await run(input)
await Bun.write(Bun.stdout, JSON.stringify(result))

function run(request: typeof input) {
  if ('usage' in request) return readUsage(request)
  if ('sessionId' in request) return readHistory(request)
  return discover(request)
}

/** Reads the files themselves: the SDK's messages carry no timestamps and no subagents. */
async function readUsage(request: v.InferOutput<typeof sessionUsageInputSchema>) {
  const config = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude')
  const projects = path.join(config, 'projects')
  const [main] = await scan(projects, `*/${request.sessionId}.jsonl`)
  if (!main) return []

  const subagents = await scan(path.join(main.slice(0, -'.jsonl'.length), 'subagents'), '*.jsonl')
  return claudeTranscriptUsage(
    await readJsonLines(main),
    await Promise.all(subagents.map((file) => readJsonLines(file))),
  )
}

async function scan(cwd: string, pattern: string) {
  try {
    return await Array.fromAsync(new Bun.Glob(pattern).scan({ absolute: true, cwd }))
  } catch {
    return []
  }
}

async function readHistory(input: v.InferOutput<typeof sessionHistoryInputSchema>) {
  const messages = await getSessionMessages(input.sessionId, { dir: input.cwd })
  return v.parse(historyMessagesSchema, claudeHistoryMessages(messages))
}

async function discover(input: v.InferOutput<typeof discoveryInputSchema>) {
  const metadata = []
  for (const dir of input.cwds) {
    const sessions = await listSessions({ dir, includeWorktrees: true, includeProgrammatic: false })
    metadata.push(
      ...sessions.map((session) => ({
        sessionId: session.sessionId,
        cwd: session.cwd ?? null,
        title: session.customTitle?.trim() || session.summary.trim() || 'Claude session',
        sourceUpdatedAt: new Date(session.lastModified).toISOString(),
        gitBranch: session.gitBranch ?? null,
      })),
    )
  }
  return v.parse(discoveredSessionsSchema, metadata)
}
