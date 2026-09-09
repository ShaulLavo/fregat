import { describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import * as v from 'valibot'
import { sessionIdSchema } from '@workspace/contracts'
import {
  discoverClaudeSessions,
  runClaudeDiscovery,
  readClaudeSessionHistory,
} from '../claude-discovery'
import { crashingDiscoveryProcess } from '../../../test/factories/discovery-process'
import { claudeTerminalResumeArgv } from '../utils/claude-terminal-resume'

const sessionId = v.parse(sessionIdSchema, 'a6035591-a607-4a70-bc57-9b59f595b664')
const request = { cwd: '/workspace', limit: 50, offset: 100 }
const metadata = {
  sessionId,
  cwd: '/workspace',
  title: 'CLI session',
  sourceUpdatedAt: '2026-09-05T00:00:00.000Z',
  gitBranch: 'main',
}

describe('Claude discovery boundary', () => {
  it('imports the canonical local transcript through an isolated SDK process', async () => {
    const configDir = await mkdtemp(path.join(tmpdir(), 'claude-history-'))
    const original = process.env.CLAUDE_CONFIG_DIR
    const projectDir = path.join(configDir, 'projects', '-workspace')
    const records = [
      {
        uuid: 'user-1',
        parentUuid: null,
        type: 'user',
        message: { role: 'user', content: 'Question' },
      },
      {
        uuid: 'answer-1',
        parentUuid: 'user-1',
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Answer' },
            { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
          ],
        },
      },
      {
        uuid: 'tool-result-1',
        parentUuid: 'answer-1',
        type: 'user',
        message: {
          role: 'user',
          content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents' }],
        },
      },
      {
        uuid: 'answer-2',
        parentUuid: 'tool-result-1',
        type: 'assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: 'Final answer' }] },
      },
    ].map((record) => ({
      ...record,
      sessionId,
      cwd: '/workspace',
      timestamp: '2026-09-05T00:00:00.000Z',
      isSidechain: false,
    }))
    try {
      await mkdir(projectDir, { recursive: true })
      await writeFile(
        path.join(projectDir, `${sessionId}.jsonl`),
        records.map((record) => JSON.stringify(record)).join('\n') + '\n',
      )
      expect(
        await readClaudeSessionHistory({
          request: { sessionId, cwd: '/workspace' },
          env: { ...process.env, CLAUDE_CONFIG_DIR: configDir },
        }),
      ).toEqual([
        { sourceId: 'user-1', role: 'user', text: 'Question', createdAt: null },
        { sourceId: 'answer-1', role: 'assistant', text: 'Answer', createdAt: null },
        { sourceId: 'answer-2', role: 'assistant', text: 'Final answer', createdAt: null },
      ])
      expect(process.env.CLAUDE_CONFIG_DIR).toBe(original)
    } finally {
      await rm(configDir, { recursive: true, force: true })
    }
  })

  it('retains process exit status and stderr when the metadata child crashes', async () => {
    await expect(
      runClaudeDiscovery({ request, env: {} }, crashingDiscoveryProcess),
    ).rejects.toMatchObject({
      code: 'provider.DISCOVERY_FAILED',
      internal: {
        exitCode: 37,
        timedOut: false,
        timeoutMs: 8_000,
        stderr: 'discovery fixture crash\n',
      },
    })
  })

  it('isolates instance environments and forwards bounded paging without mutating process state', async () => {
    const original = process.env.CLAUDE_CONFIG_DIR
    const received: string[] = []
    const runner = async (input: { request: typeof request; env: NodeJS.ProcessEnv }) => {
      expect(input.request).toEqual(request)
      received.push(input.env.CLAUDE_CONFIG_DIR ?? '')
      return [{ ...metadata, transcript: 'must not cross the metadata boundary' }]
    }
    const [first, second] = await Promise.all([
      discoverClaudeSessions({ request, env: { CLAUDE_CONFIG_DIR: '/account-a' }, runner }),
      discoverClaudeSessions({ request, env: { CLAUDE_CONFIG_DIR: '/account-b' }, runner }),
    ])
    expect(received).toEqual(['/account-a', '/account-b'])
    expect(first).toEqual([metadata])
    expect(second).toEqual([metadata])
    expect(process.env.CLAUDE_CONFIG_DIR).toBe(original)
  })

  it('rejects invalid UUIDs and oversized provider pages at the boundary', async () => {
    await expect(
      discoverClaudeSessions({
        request,
        env: {},
        runner: async () => [{ ...metadata, sessionId: 'not-a-uuid' }],
      }),
    ).rejects.toThrow()
    let calls = 0
    await expect(
      discoverClaudeSessions({
        request: { ...request, limit: 101 },
        env: {},
        runner: async () => {
          calls += 1
          return []
        },
      }),
    ).rejects.toThrow()
    expect(calls).toBe(0)
  })

  it('uses the exact durable UUID for terminal resumption', () => {
    expect(claudeTerminalResumeArgv(sessionId)).toEqual(['claude', '--resume', sessionId])
  })
})
