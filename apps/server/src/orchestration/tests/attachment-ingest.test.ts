import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { Database } from 'bun:sqlite'
import { drizzle } from 'drizzle-orm/bun-sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import * as v from 'valibot'

import * as schema from '../../db/schema'
import { migrateOrchestrationDatabase } from '../../db/migrations'
import { OrchestrationEngine } from '../engine'
import { orchestrationCommandSummary } from '../orchestration-logging'
import { orchestrationCommandSchema, type OrchestrationCommand } from '@workspace/contracts'

const now = '2026-06-20T00:00:00.000Z'
const later = '2026-06-20T00:01:00.000Z'

// Real 1x1 PNG bytes; the on-disk blob is compared against them verbatim.
const pngBytes = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, 0x08, 0x06, 0x00, 0x00, 0x00, 0x1f, 0x15, 0xc4,
  0x89,
])
const pngDataUrl = `data:image/png;base64,${Buffer.from(pngBytes).toString('base64')}`

const roots: string[] = []
const closers: Array<() => void> = []

afterEach(async () => {
  for (const close of closers.splice(0)) close()

  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('client command attachment ingest', () => {
  it('writes attachment bytes to disk and keeps base64 out of every persisted surface', async () => {
    const fixture = await createFixture()

    await fixture.engine.dispatch(v.parse(orchestrationCommandSchema, projectCreateCommand()))
    await fixture.engine.dispatchClientCommand(sessionCreateCommand())
    await fixture.engine.dispatchClientCommand(turnStartCommand([pngAttachment()]))

    const blob = await readFile(path.join(fixture.attachmentsDir, 'attachment-1.png'))
    expect(Array.from(blob)).toEqual(Array.from(pngBytes))

    expect(persistedJson(fixture.database)).not.toContain('dataUrl')
    expect(persistedJson(fixture.database)).not.toContain('base64')

    const projected = fixture.database.select().from(schema.projectionSessionMessages).all()
    expect(projected.map((row) => JSON.parse(row.attachmentsJson))).toEqual([[pngMetadata()]])

    const message = (
      await fixture.engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')
    ).session.messages[0]
    expect(message).toMatchObject({ id: 'message-1', text: 'What is in this screenshot?' })
    expect(message?.attachments).toEqual([pngMetadata()])
  })

  it('drops an unwritable attachment instead of failing the turn', async () => {
    const fixture = await createFixture()

    await fixture.engine.dispatch(v.parse(orchestrationCommandSchema, projectCreateCommand()))
    await fixture.engine.dispatchClientCommand(sessionCreateCommand())
    const result = await fixture.engine.dispatchClientCommand(
      turnStartCommand([
        {
          type: 'image',
          id: 'attachment-svg',
          name: 'diagram.svg',
          mimeType: 'image/svg+xml',
          sizeBytes: 12,
          dataUrl: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=',
        },
      ]),
    )

    expect(result.deduped).toBe(false)
    expect(existsSync(fixture.attachmentsDir)).toBe(false)

    const message = (
      await fixture.engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')
    ).session.messages[0]
    expect(message?.text).toBe('What is in this screenshot?')
    expect(message?.attachments).toEqual([])
  })

  it('keeps the writable attachments of a partially broken batch', async () => {
    const fixture = await createFixture()

    await fixture.engine.dispatch(v.parse(orchestrationCommandSchema, projectCreateCommand()))
    await fixture.engine.dispatchClientCommand(sessionCreateCommand())
    await fixture.engine.dispatchClientCommand(
      turnStartCommand([
        {
          type: 'image',
          id: 'attachment-heic',
          name: 'photo.heic',
          mimeType: 'image/heic',
          sizeBytes: 4,
          dataUrl: 'data:image/heic;base64,AAAA',
        },
        pngAttachment(),
      ]),
    )

    const message = (
      await fixture.engine.sessionDetailSnapshot('00000000-0000-4000-8000-000000000001')
    ).session.messages[0]
    expect(message?.attachments).toEqual([pngMetadata()])
    expect(existsSync(path.join(fixture.attachmentsDir, 'attachment-heic.heic'))).toBe(false)
    expect(existsSync(path.join(fixture.attachmentsDir, 'attachment-1.png'))).toBe(true)
  })
})

describe('orchestrationCommandSummary', () => {
  it('reports persisted and dropped attachment ingest on the command event', () => {
    const command = v.parse(
      orchestrationCommandSchema,
      turnStartCommand([pngMetadata()]),
    ) as OrchestrationCommand

    expect(
      orchestrationCommandSummary(command, {
        bytesPersisted: pngBytes.byteLength,
        dropReasons: ['attachment-svg: unsupported image type'],
        dropped: 1,
        persisted: 1,
      }),
    ).toMatchObject({
      attachmentBytesPersisted: pngBytes.byteLength,
      attachmentCount: 1,
      attachmentDropReasons: ['attachment-svg: unsupported image type'],
      attachmentsDropped: 1,
      attachmentsPersisted: 1,
      commandType: 'session.turn.start',
    })
  })
})

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-attachment-ingest-'))
  roots.push(root)

  const attachmentsDir = path.join(root, 'attachments')
  const sqlite = new Database(':memory:', { create: true })
  closers.push(() => sqlite.close())
  const database = drizzle({ client: sqlite, schema })
  migrateOrchestrationDatabase(database)

  return {
    attachmentsDir,
    database,
    engine: new OrchestrationEngine(database, { attachmentsDir }),
  }
}

function persistedJson(database: Awaited<ReturnType<typeof createFixture>>['database']) {
  const events = database.select().from(schema.orchestrationEvents).all()
  const receipts = database.select().from(schema.orchestrationCommandReceipts).all()

  return [...events.map((row) => row.payloadJson), ...receipts.map((row) => row.commandJson)].join(
    '\n',
  )
}

function pngAttachment() {
  return { ...pngMetadata(), dataUrl: pngDataUrl }
}

function pngMetadata() {
  return {
    type: 'image',
    id: 'attachment-1',
    name: 'shot.png',
    mimeType: 'image/png',
    sizeBytes: pngBytes.byteLength,
  }
}

function projectCreateCommand() {
  return {
    worktreeId: '20000000-0000-4000-8000-000000000001',
    repositoryKey: 'fixture-repository',
    repositoryKind: 'directory',
    repositoryIdentity: { source: 'path', canonical: '/workspace' },
    canonicalPath: '/workspace',
    path: '/workspace',
    branch: null,
    registrationGeneration: 0,
    kind: 'current',
    ownership: 'protected',
    updatedAt: '2026-05-24T00:00:00.000Z',
    intentFingerprint: 'fixture-intent',
    commandId: 'cmd-project-create',
    createdAt: now,
    defaultModelSelection: null,
    projectId: '10000000-0000-4000-8000-000000000001',
    title: 'Platform',
    type: 'project.create',
    workspaceRoot: '/workspace',
  }
}

function sessionCreateCommand() {
  return {
    worktreeTarget: { kind: 'current', worktreeId: '20000000-0000-4000-8000-000000000001' },

    commandId: 'cmd-session-create',
    createdAt: now,
    interactionMode: 'default',
    modelSelection: { model: 'gpt-5-codex', providerInstanceId: 'codex' },

    runtimeMode: 'full-access',
    sessionId: '00000000-0000-4000-8000-000000000001',
    title: 'Attachments',
    type: 'session.create',
  }
}

function turnStartCommand(attachments: readonly unknown[]) {
  return {
    commandId: 'cmd-turn-start',
    createdAt: later,
    interactionMode: 'default',
    message: {
      attachments,
      messageId: 'message-1',
      role: 'user',
      text: 'What is in this screenshot?',
    },
    runtimeMode: 'full-access',
    sessionId: '00000000-0000-4000-8000-000000000001',
    turnId: 'turn-1',
    type: 'session.turn.start',
  }
}
