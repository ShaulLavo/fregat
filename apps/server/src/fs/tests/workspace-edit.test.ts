import { createHash, randomUUID } from 'node:crypto'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type {
  WorkspaceEditPrepareRequest,
  WorkspaceEditReleaseRequest,
  WorkspaceEditResult,
  WorkspaceEditTransitionRequest,
  WorkspacePersistenceOperation,
  WorkspaceResourcePrecondition,
} from '@workspace/contracts'
import { Elysia } from 'elysia'
import type { WideEvent } from 'evlog'
import { readFsLogs } from 'evlog/fs'
import { afterEach, describe, expect, it } from 'vitest'

import { applyObservability, flushObservability } from '../../observability'
import { initializeObservability, resetObservabilityForTests } from '../../observability/runtime'
import { FsError } from '../errors'
import { fsRoutes } from '../routes'
import { FileSystemService } from '../service'
import { textFileVersion } from '../version'
import {
  WORKSPACE_EDIT_STABLE_TTL_MS,
  nodeWorkspaceEditFileSystemDriver,
  type WorkspaceEditFileSystemDriver,
  type WorkspaceEditFileHandle,
} from '../workspace-edit-journal'
import { WORKSPACE_EDIT_LEASE_MS } from '../workspace-edit'
import type { WatchServerMessage } from '../contracts'

type FixtureOptions = {
  readonly clock?: () => number
  readonly driver?: (workspaceRoot: string, journalRoot: string) => WorkspaceEditFileSystemDriver
  readonly journalInsideWorkspace?: boolean
  readonly watch?: boolean
}

type WorkspaceEditFixture = {
  readonly baseRoot: string
  readonly journalRoot: string
  readonly service: FileSystemService
  readonly workspaceRoot: string
}

type EventStream = {
  readonly abort: AbortController
  readonly events: AsyncIterator<WatchServerMessage>
}

type ResourceSnapshot = {
  readonly bytes: Buffer
  readonly ino: number
  readonly mode: number
  readonly mtimeMs: number
  readonly nlink: number
  readonly size: number
}

const fixtures: WorkspaceEditFixture[] = []

afterEach(async () => {
  for (const fixture of fixtures.splice(0).reverse()) {
    await fixture.service.close()
    await rm(fixture.baseRoot, { force: true, recursive: true })
  }
})

describe('workspace edit transactions', () => {
  it('prepare has no visible filesystem or watcher effect', async () => {
    const fixture = await createFixture({ watch: true })
    const source = await seedFile(fixture, 'source.txt', 'source bytes')
    const destination = await seedFile(fixture, 'destination.txt', 'destination bytes')
    const sourceBefore = await resourceSnapshot(fixture, 'source.txt')
    const destinationBefore = await resourceSnapshot(fixture, 'destination.txt')
    const stream = await startEvents(fixture.service)
    const operationId = randomUUID()

    try {
      const prepared = await fixture.service.workspaceEditPrepare(
        prepareRequest(operationId, [
          renameOperation(0, 'source.txt', 'destination.txt', source, destination, true),
        ]),
      )

      expect(prepared).toMatchObject({ generation: 1, state: 'prepared' })
      expect(await resourceSnapshot(fixture, 'source.txt')).toEqual(sourceBefore)
      expect(await resourceSnapshot(fixture, 'destination.txt')).toEqual(destinationBefore)
      expect(await nextEvent(stream.events, 100)).toBeUndefined()
    } finally {
      await stopEvents(stream)
    }
  })

  it('prepare reserves absent resource slots without moving copying or linking source or destination', async () => {
    const fixture = await createFixture()
    const source = await seedFile(fixture, 'source.txt', 'source bytes')
    const destination = await seedFile(fixture, 'destination.txt', 'destination bytes')
    const sourceBefore = await resourceSnapshot(fixture, 'source.txt')
    const destinationBefore = await resourceSnapshot(fixture, 'destination.txt')
    const operationId = randomUUID()

    await fixture.service.workspaceEditPrepare(
      prepareRequest(operationId, [
        renameOperation(0, 'source.txt', 'destination.txt', source, destination, true),
      ]),
    )

    const manifest = await readManifest(fixture, operationId)
    const leg = manifest.legs[0] as { reservedPath?: string }
    expect(leg.reservedPath).toEqual(expect.any(String))
    expect(await pathExists(path.join(fixture.journalRoot, operationId, leg.reservedPath!))).toBe(
      false,
    )
    expect(await resourceSnapshot(fixture, 'source.txt')).toEqual(sourceBefore)
    expect(await resourceSnapshot(fixture, 'destination.txt')).toEqual(destinationBefore)
  })

  it('fsyncs inverse intent before the first resource move into a reserved slot', async () => {
    const observation = { intentSynced: false, resourceMoveObserved: false }
    const fixture = await createFixture({
      driver: (workspaceRoot, journalRoot) =>
        observingResourceMoveDriver(workspaceRoot, journalRoot, observation),
    })
    const source = await seedFile(fixture, 'source.txt', 'source bytes')
    const destination = await seedFile(fixture, 'destination.txt', 'destination bytes')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        renameOperation(0, 'source.txt', 'destination.txt', source, destination, true),
      ]),
    )

    await fixture.service.workspaceEditCommit(transition(prepared))

    expect(observation.resourceMoveObserved).toBe(true)
    expect(observation.intentSynced).toBe(true)
  })

  it('aborting a prepared resource transaction removes metadata only', async () => {
    const fixture = await createFixture()
    const source = await seedFile(fixture, 'source.txt', 'source bytes')
    const destination = await seedFile(fixture, 'destination.txt', 'destination bytes')
    const sourceBefore = await resourceSnapshot(fixture, 'source.txt')
    const destinationBefore = await resourceSnapshot(fixture, 'destination.txt')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        renameOperation(0, 'source.txt', 'destination.txt', source, destination, true),
      ]),
    )

    const request = transition(prepared)
    const aborted = await fixture.service.workspaceEditAbort(request)

    expect(aborted).toMatchObject({ generation: 2, state: 'aborted' })
    expect(await fixture.service.workspaceEditAbort(request)).toEqual(aborted)
    expect(await resourceSnapshot(fixture, 'source.txt')).toEqual(sourceBefore)
    expect(await resourceSnapshot(fixture, 'destination.txt')).toEqual(destinationBefore)
    expect(await readdir(path.join(fixture.journalRoot, prepared.operationId))).toEqual([
      'manifest.json',
    ])
  })

  it('abort before prepare prevents the later prepare from staging', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'file.txt', 'before')
    const operationId = randomUUID()
    const request = prepareRequest(operationId, [writeOperation(0, 'file.txt', expected, 'after')])
    const abort = {
      expectedGeneration: 0,
      operationId,
      transitionId: randomUUID(),
    }

    const aborted = await fixture.service.workspaceEditAbort(abort)
    const latePrepare = await fixture.service.workspaceEditPrepare(request)

    expect(aborted).toMatchObject({ generation: 0, state: 'aborted' })
    expect(latePrepare).toEqual(aborted)
    expect(await pathExists(path.join(fixture.journalRoot, operationId))).toBe(false)
    expect(await readText(fixture, 'file.txt')).toBe('before')
  })

  it('abort waits for an in-flight prepare and leaves no journal lease watcher or visible effect', async () => {
    const pause = deferred<void>()
    const entered = deferred<void>()
    const fixture = await createFixture({
      driver: (_workspaceRoot, journalRoot) => pausingPrepareDriver(journalRoot, entered, pause),
    })
    const expected = await seedFile(fixture, 'file.txt', 'before')
    const operationId = randomUUID()
    const prepare = fixture.service.workspaceEditPrepare(
      prepareRequest(operationId, [writeOperation(0, 'file.txt', expected, 'after')]),
    )
    await entered.promise

    expect(await fixture.service.workspaceEditStatus(operationId)).toMatchObject({
      found: true,
      result: { generation: 0, state: 'preparing' },
    })
    const abort = fixture.service.workspaceEditAbort({
      expectedGeneration: 0,
      operationId,
      transitionId: randomUUID(),
    })
    pause.resolve()
    const [prepareResult, abortResult] = await Promise.all([prepare, abort])

    expect(prepareResult).toMatchObject({ state: 'aborted' })
    expect(abortResult).toEqual(prepareResult)
    expect(await pathExists(path.join(fixture.journalRoot, operationId))).toBe(false)
    expect(await readText(fixture, 'file.txt')).toBe('before')
    await expect(
      fixture.service.write({ content: 'legacy', path: 'file.txt' }),
    ).resolves.toMatchObject({ path: 'file.txt' })
  })

  it('commits and finalizes two guarded writes in order', async () => {
    const fixture = await createFixture()
    const first = await seedFile(fixture, 'first.txt', 'first before')
    const second = await seedFile(fixture, 'second.txt', 'second before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'first.txt', first, 'first after'),
        writeOperation(1, 'second.txt', second, 'second after'),
      ]),
    )

    const committed = await fixture.service.workspaceEditCommit(transition(prepared))
    expect(committed).toMatchObject({ generation: 2, state: 'committed' })
    expect(await readTexts(fixture, ['first.txt', 'second.txt'])).toEqual([
      'first after',
      'second after',
    ])

    const finalized = await fixture.service.workspaceEditFinalize(transition(committed))
    expect(finalized).toMatchObject({
      affectedPaths: ['first.txt', 'second.txt'],
      generation: 3,
      state: 'finalized',
    })
  })

  it('rejects last-target drift after prepare at whole-set commit revalidation before mutation', async () => {
    const fixture = await createFixture()
    const first = await seedFile(fixture, 'first.txt', 'first before')
    const second = await seedFile(fixture, 'second.txt', 'second before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'first.txt', first, 'first after'),
        writeOperation(1, 'second.txt', second, 'second after'),
      ]),
    )
    await writeFile(workspacePath(fixture, 'second.txt'), 'external drift')

    await expect(fixture.service.workspaceEditCommit(transition(prepared))).rejects.toMatchObject({
      code: 'WORKSPACE_EDIT_STALE',
    })
    expect(await readText(fixture, 'first.txt')).toBe('first before')
    expect(await readText(fixture, 'second.txt')).toBe('external drift')
  })

  it('reverses the first write when the second commit leg fails', async () => {
    const failure = { failSecondForward: true }
    const fixture = await createFixture({
      driver: (workspaceRoot) => failingSecondWriteDriver(workspaceRoot, failure),
    })
    const first = await seedFile(fixture, 'first.txt', 'first before')
    const second = await seedFile(fixture, 'second.txt', 'second before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'first.txt', first, 'first after'),
        writeOperation(1, 'second.txt', second, 'second after'),
      ]),
    )

    const result = await fixture.service.workspaceEditCommit(transition(prepared))

    expect(result).toMatchObject({ state: 'rolled-back' })
    expect(fixture.service.changes.transactionBarrierInfo(prepared.operationId)).toBeNull()
    expect(await readTexts(fixture, ['first.txt', 'second.txt'])).toEqual([
      'first before',
      'second before',
    ])
  })

  it('reports exact unrecovered relative paths and recovers only remaining inverse intents', async () => {
    const failure = { failCompensation: true, failSecondForward: true, firstRenameCount: 0 }
    const fixture = await createFixture({
      driver: (workspaceRoot) => partialWriteDriver(workspaceRoot, failure),
    })
    const first = await seedFile(fixture, 'first.txt', 'first before')
    const second = await seedFile(fixture, 'second.txt', 'second before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'first.txt', first, 'first after'),
        writeOperation(1, 'second.txt', second, 'second after'),
      ]),
    )
    const stream = await startEvents(fixture.service)

    try {
      const partial = await fixture.service.workspaceEditCommit(transition(prepared))
      expect(partial).toMatchObject({
        recoveryTarget: 'rolled-back',
        state: 'partial',
        unrecoveredPaths: ['first.txt'],
      })
      expect(await nextEvent(stream.events)).toMatchObject({
        origin: 'workspace-edit',
        path: 'first.txt',
        type: 'changed',
        writeId: prepared.operationId,
      })
      expect(await readTexts(fixture, ['first.txt', 'second.txt'])).toEqual([
        'first after',
        'second before',
      ])

      failure.failCompensation = false
      const recovered = await fixture.service.workspaceEditRecover({
        ...transition(partial),
        recoveryTarget: 'rolled-back',
      })
      expect(recovered).toMatchObject({
        state: 'rolled-back',
        unrecoveredPaths: [],
      })
      expect(await readTexts(fixture, ['first.txt', 'second.txt'])).toEqual([
        'first before',
        'second before',
      ])
    } finally {
      await stopEvents(stream)
    }
  })

  it('commits create then write in protocol order', async () => {
    const fixture = await createFixture()
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        createOperation(0, 'created.txt'),
        writeOperation(1, 'created.txt', transactionPrecondition(0), 'created and written'),
      ]),
    )
    const stream = await startEvents(fixture.service)

    try {
      const finalized = await commitAndFinalize(fixture.service, prepared)

      expect(finalized.state).toBe('finalized')
      expect(await readText(fixture, 'created.txt')).toBe('created and written')
      expect(await nextEvent(stream.events)).toMatchObject({
        origin: 'workspace-edit',
        path: 'created.txt',
        type: 'created',
      })
    } finally {
      await stopEvents(stream)
    }
  })

  it('commits rename then edit at the new path and edit then rename using the edited source', async () => {
    const fixture = await createFixture()
    const first = await seedFile(fixture, 'first.txt', 'first before')
    const second = await seedFile(fixture, 'second.txt', 'second before')
    const renameThenEdit = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        renameOperation(0, 'first.txt', 'first-renamed.txt', first, missingPrecondition(), false),
        writeOperation(1, 'first-renamed.txt', transactionPrecondition(0), 'first after'),
      ]),
    )
    await commitAndFinalize(fixture.service, renameThenEdit)

    const editThenRename = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'second.txt', second, 'second after'),
        renameOperation(
          1,
          'second.txt',
          'second-renamed.txt',
          transactionPrecondition(0),
          missingPrecondition(),
          false,
        ),
      ]),
    )
    await commitAndFinalize(fixture.service, editThenRename)

    expect(await readText(fixture, 'first-renamed.txt')).toBe('first after')
    expect(await readText(fixture, 'second-renamed.txt')).toBe('second after')
    expect(await pathExists(workspacePath(fixture, 'first.txt'))).toBe(false)
    expect(await pathExists(workspacePath(fixture, 'second.txt'))).toBe(false)
  })

  it('moves a regular-file delete into the journal and restores it on undo and redo', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'deleted.txt', 'restore me')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [deleteOperation(0, 'deleted.txt', expected)]),
    )
    const finalized = await commitAndFinalize(fixture.service, prepared)
    expect(await pathExists(workspacePath(fixture, 'deleted.txt'))).toBe(false)

    const undoCommitted = await fixture.service.workspaceEditUndo(transition(finalized))
    expect(undoCommitted.state).toBe('undo-committed')
    const undone = await fixture.service.workspaceEditFinalize(transition(undoCommitted))
    expect(undone.state).toBe('undone')
    expect(await readText(fixture, 'deleted.txt')).toBe('restore me')

    const redoCommitted = await fixture.service.workspaceEditRedo(transition(undone))
    expect(redoCommitted.state).toBe('redo-committed')
    const redone = await fixture.service.workspaceEditFinalize(transition(redoCommitted))
    expect(redone.state).toBe('redone')
    expect(await pathExists(workspacePath(fixture, 'deleted.txt'))).toBe(false)
  })

  it('restores an overwrite rename destination through undo and redo', async () => {
    const fixture = await createFixture()
    const source = await seedFile(fixture, 'source.txt', 'source bytes')
    const destination = await seedFile(fixture, 'destination.txt', 'destination bytes')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        renameOperation(0, 'source.txt', 'destination.txt', source, destination, true),
      ]),
    )
    const finalized = await commitAndFinalize(fixture.service, prepared)
    expect(await readText(fixture, 'destination.txt')).toBe('source bytes')

    const undone = await undoAndFinalize(fixture.service, finalized)
    expect(await readTexts(fixture, ['source.txt', 'destination.txt'])).toEqual([
      'source bytes',
      'destination bytes',
    ])

    const redone = await redoAndFinalize(fixture.service, undone)
    expect(redone.state).toBe('redone')
    expect(await pathExists(workspacePath(fixture, 'source.txt'))).toBe(false)
    expect(await readText(fixture, 'destination.txt')).toBe('source bytes')
  })

  it('commit finalize rollback status abort undo redo recover and release honor transition generations', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'file.txt', 'before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', expected, 'after')]),
    )
    const commitRequest = transition(prepared)
    const committed = await fixture.service.workspaceEditCommit(commitRequest)

    expect(await fixture.service.workspaceEditCommit(commitRequest)).toEqual(committed)
    await expect(
      fixture.service.workspaceEditCommit({
        ...commitRequest,
        expectedGeneration: committed.generation,
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_INVALID' })
    expect(await fixture.service.workspaceEditStatus(prepared.operationId)).toEqual({
      found: true,
      result: committed,
    })

    const rolledBack = await fixture.service.workspaceEditRollback(transition(committed))
    expect(rolledBack).toMatchObject({ generation: 3, state: 'rolled-back' })
    const released = await fixture.service.workspaceEditRelease(transition(rolledBack))
    expect(released).toMatchObject({ generation: 4, state: 'released' })
  })

  it('a new undo after redo is not mistaken for a retried undo', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'file.txt', 'before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', expected, 'after')]),
    )
    const finalized = await commitAndFinalize(fixture.service, prepared)
    const firstUndone = await undoAndFinalize(fixture.service, finalized)
    const redone = await redoAndFinalize(fixture.service, firstUndone)

    const secondUndone = await undoAndFinalize(fixture.service, redone)

    expect(secondUndone.state).toBe('undone')
    expect(secondUndone.generation).toBeGreaterThan(firstUndone.generation)
    expect(await readText(fixture, 'file.txt')).toBe('before')
  })

  it('queues matching native commit events until one ordered finalize group', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'file.txt', 'before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', expected, 'after')]),
    )
    const stream = await startEvents(fixture.service)

    try {
      const committed = await fixture.service.workspaceEditCommit(transition(prepared))
      fixture.service.changes.emit({ path: 'file.txt', type: 'changed' })
      fixture.service.changes.emit({ path: 'unrelated.txt', type: 'changed' })

      expect(fixture.service.changes.transactionBarrierInfo(prepared.operationId)).toEqual({
        paths: ['file.txt'],
        queuedEventCount: 1,
      })
      expect(await nextEvent(stream.events)).toMatchObject({ path: 'unrelated.txt' })

      await fixture.service.workspaceEditFinalize(transition(committed))
      expect(await nextEvent(stream.events)).toMatchObject({
        origin: 'workspace-edit',
        path: 'file.txt',
        type: 'changed',
        writeId: prepared.operationId,
      })
      fixture.service.changes.emit({
        path: 'file.txt',
        type: 'changed',
        version: textFileVersion('after'),
      })
      expect(await nextEvent(stream.events)).toMatchObject({
        origin: 'workspace-edit',
        path: 'file.txt',
        writeId: prepared.operationId,
      })
      fixture.service.changes.recordTransactionResults(prepared.operationId, 4, [
        { exists: true, path: 'file.txt', version: textFileVersion('after') },
      ])
      fixture.service.changes.emit({
        path: 'file.txt',
        type: 'changed',
        version: textFileVersion('external'),
      })
      const external = await nextEvent(stream.events)
      expect(external).toEqual(expect.objectContaining({ path: 'file.txt', type: 'changed' }))
      expect(external).not.toHaveProperty('origin')
      expect(external).not.toHaveProperty('writeId')
      expect(await nextEvent(stream.events, 30)).toBeUndefined()
    } finally {
      await stopEvents(stream)
    }
  })

  it('serializes a transaction against legacy write and tree rename in the same workspace', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'file.txt', 'before')
    await seedFile(fixture, 'other.txt', 'other')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', expected, 'after')]),
    )

    await expect(
      fixture.service.write({ content: 'legacy', path: 'file.txt' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_BUSY' })
    await expect(
      fixture.service.rename({ from: 'other.txt', to: 'renamed.txt' }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_BUSY' })

    await fixture.service.workspaceEditAbort(transition(prepared))
  })

  it('blocks a parent directory mutation while a nested workspace has a lease', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'parent/project/file.txt', 'before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(
        randomUUID(),
        [writeOperation(0, 'file.txt', expected, 'after')],
        'parent/project',
      ),
    )

    await expect(fixture.service.delete({ path: 'parent', recursive: true })).rejects.toMatchObject(
      {
        code: 'WORKSPACE_EDIT_BUSY',
      },
    )
    expect(await readText(fixture, 'parent/project/file.txt')).toBe('before')
    await fixture.service.workspaceEditAbort(transition(prepared))
  })

  it('serializes overlapping transactions and allows disjoint workspace transactions', async () => {
    const fixture = await createFixture()
    await mkdir(workspacePath(fixture, 'one'), { recursive: true })
    await mkdir(workspacePath(fixture, 'two'), { recursive: true })
    const one = await seedFile(fixture, 'one/file.txt', 'one')
    const two = await seedFile(fixture, 'two/file.txt', 'two')
    const first = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', one, 'one after')], 'one'),
    )
    const disjoint = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', two, 'two after')], 'two'),
    )

    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', one, 'blocked')], 'one'),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_BUSY' })
    await Promise.all([
      fixture.service.workspaceEditCommit(transition(first)),
      fixture.service.workspaceEditCommit(transition(disjoint)),
    ])
    expect(await readTexts(fixture, ['one/file.txt', 'two/file.txt'])).toEqual([
      'one after',
      'two after',
    ])
  })

  it.each(['directory-alias/file.txt', 'file-alias'])(
    'reserves a transaction against writes through %s',
    async (alias) => {
      const fixture = await createFixture()
      const expected = await seedFile(fixture, 'project/file.txt', 'before')
      await symlink('project', workspacePath(fixture, 'directory-alias'))
      await symlink('project/file.txt', workspacePath(fixture, 'file-alias'))
      const prepared = await fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', expected, 'after')], 'project'),
      )

      const write = fixture.service.write({ content: 'unreserved write', path: alias })
      await write.catch(() => {})
      expect(await readText(fixture, 'project/file.txt')).toBe('before')
      await expect(write).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_BUSY' })
      await fixture.service.workspaceEditAbort(transition(prepared))
    },
  )

  it('reserved journal paths never appear in tree search index or watch', async () => {
    const fixture = await createFixture({ journalInsideWorkspace: true })
    const expected = await seedFile(fixture, 'file.txt', 'journal-exclusion-before')
    await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'file.txt', expected, 'journal-exclusion-after'),
      ]),
    )

    const tree = await fixture.service.tree('', 10)
    expect(tree.entries.some((entry) => entry.path.startsWith('journals-visible'))).toBe(false)

    await fixture.service.openWorkspaceRoot({ generation: 1, path: '' })
    await waitForIndexReady(fixture.service)
    expect(fixture.service.workspaceIndex?.get('journals-visible')).toBeUndefined()

    const matches = await collectSearchMatches(fixture.service, 'journal-exclusion-after')
    expect(matches).toEqual([])

    const stream = await startEvents(fixture.service)
    try {
      fixture.service.changes.emit({ path: 'journals-visible/leak', type: 'created' })
      fixture.service.changes.emit({ path: 'ordinary.txt', type: 'created' })
      expect(await nextEvent(stream.events)).toMatchObject({ path: 'ordinary.txt' })
      expect(await nextEvent(stream.events, 30)).toBeUndefined()
    } finally {
      await stopEvents(stream)
    }
  })

  it('expires an abandoned prepared lease and reaps expired stable journals', async () => {
    let now = 10_000
    const fixture = await createFixture({ clock: () => now })
    const firstExpected = await seedFile(fixture, 'first.txt', 'first')
    const abandoned = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'first.txt', firstExpected, 'first after')]),
    )
    now += WORKSPACE_EDIT_LEASE_MS + 1
    const secondExpected = await seedFile(fixture, 'second.txt', 'second')
    const replacement = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'second.txt', secondExpected, 'second after'),
      ]),
    )

    expect(await fixture.service.workspaceEditStatus(abandoned.operationId)).toMatchObject({
      found: true,
      result: { state: 'aborted' },
    })
    const finalized = await commitAndFinalize(fixture.service, replacement)
    now += WORKSPACE_EDIT_STABLE_TTL_MS + 1
    const thirdExpected = await seedFile(fixture, 'third.txt', 'third')
    await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'third.txt', thirdExpected, 'third after')]),
    )

    expect(await fixture.service.workspaceEditStatus(finalized.operationId)).toMatchObject({
      found: true,
      result: { state: 'released' },
    })
    expect(await pathExists(path.join(fixture.journalRoot, finalized.operationId))).toBe(false)
  })

  it('preserves mode on commit and restores bytes mode mtime and version on text rollback', async () => {
    const fixture = await createFixture()
    await seedFile(fixture, 'file.txt', 'before bytes')
    const originalMtime = new Date(Date.now() - 60_000)
    await chmod(workspacePath(fixture, 'file.txt'), 0o640)
    await utimes(workspacePath(fixture, 'file.txt'), originalMtime, originalMtime)
    const before = await resourceSnapshot(fixture, 'file.txt')
    const expected = await snapshotPrecondition(fixture, 'file.txt')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', expected, 'after bytes')]),
    )

    const committed = await fixture.service.workspaceEditCommit(transition(prepared))
    expect((await lstat(workspacePath(fixture, 'file.txt'))).mode & 0o777).toBe(0o640)
    const rolledBack = await fixture.service.workspaceEditRollback(transition(committed))
    const restored = await resourceSnapshot(fixture, 'file.txt')

    expect(rolledBack.state).toBe('rolled-back')
    expect(restored.bytes).toEqual(before.bytes)
    expect(restored.mode).toBe(before.mode)
    expect(restored.mtimeMs).toBeCloseTo(before.mtimeMs, 0)
    expect((await fixture.service.read('file.txt')).version).toBe(textFileVersion('before bytes'))
  })

  it('a failed recovery remains partial and exact acknowledgement release changes no path', async () => {
    const failure = { failCompensation: true, failSecondForward: true, firstRenameCount: 0 }
    const fixture = await createFixture({
      driver: (workspaceRoot) => partialWriteDriver(workspaceRoot, failure),
    })
    const first = await seedFile(fixture, 'first.txt', 'first before')
    const second = await seedFile(fixture, 'second.txt', 'second before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'first.txt', first, 'first after'),
        writeOperation(1, 'second.txt', second, 'second after'),
      ]),
    )
    const partial = await fixture.service.workspaceEditCommit(transition(prepared))
    const failedRecovery = await fixture.service.workspaceEditRecover({
      ...transition(partial),
      recoveryTarget: 'rolled-back',
    })

    expect(failedRecovery).toMatchObject({
      generation: partial.generation + 1,
      state: 'partial',
      unrecoveredPaths: ['first.txt'],
    })
    await expect(
      fixture.service.workspaceEditRelease(transition(failedRecovery)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_PARTIAL' })
    await expect(
      fixture.service.workspaceEditRelease({
        ...transition(failedRecovery),
        acknowledgePartial: {
          generation: failedRecovery.generation,
          unrecoveredPaths: ['wrong.txt'],
        },
      }),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_STALE' })
    const beforeRelease = await readTexts(fixture, ['first.txt', 'second.txt'])
    const released = await fixture.service.workspaceEditRelease({
      ...transition(failedRecovery),
      acknowledgePartial: {
        generation: failedRecovery.generation,
        unrecoveredPaths: failedRecovery.unrecoveredPaths,
      },
    })

    expect(released.state).toBe('released')
    expect(await readTexts(fixture, ['first.txt', 'second.txt'])).toEqual(beforeRelease)
  })

  it('audits only the first successful partial acknowledgement release', async () => {
    const failure = { failCompensation: true, failSecondForward: true, firstRenameCount: 0 }
    const fixture = await createFixture({
      driver: (workspaceRoot) => partialWriteDriver(workspaceRoot, failure),
    })
    const first = await seedFile(fixture, 'first.txt', 'first before')
    const second = await seedFile(fixture, 'second.txt', 'second before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'first.txt', first, 'first after'),
        writeOperation(1, 'second.txt', second, 'second after'),
      ]),
    )
    const partial = await fixture.service.workspaceEditCommit(transition(prepared))
    const failedRecovery = await fixture.service.workspaceEditRecover({
      ...transition(partial),
      recoveryTarget: 'rolled-back',
    })
    const stableFixture = await createFixture()
    const stableExpected = await seedFile(stableFixture, 'stable.txt', 'stable before')
    const stablePrepared = await stableFixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'stable.txt', stableExpected, 'stable after'),
      ]),
    )
    const stable = await commitAndFinalize(stableFixture.service, stablePrepared)
    const logDir = path.join(fixture.baseRoot, 'audit-logs')
    initializeObservability(testObservabilityEnv(logDir))

    try {
      const partialApp = observedFsApp(fixture.service)
      const stableApp = observedFsApp(stableFixture.service)
      const mismatchedBody = {
        ...transition(failedRecovery),
        acknowledgePartial: {
          generation: failedRecovery.generation,
          unrecoveredPaths: ['wrong.txt'],
        },
      }
      const releaseBody = {
        ...transition(failedRecovery),
        acknowledgePartial: {
          generation: failedRecovery.generation,
          unrecoveredPaths: failedRecovery.unrecoveredPaths,
        },
      }
      const stableBody = {
        ...transition(stable),
        acknowledgePartial: {
          generation: stable.generation,
          unrecoveredPaths: [] as string[],
        },
      }

      expect((await postRelease(partialApp, mismatchedBody, 'release-mismatch')).status).toBe(409)
      expect((await postRelease(partialApp, releaseBody, 'release-partial')).status).toBe(200)
      expect((await postRelease(partialApp, releaseBody, 'release-replay')).status).toBe(200)
      expect((await postRelease(stableApp, stableBody, 'release-stable')).status).toBe(200)

      const events = await flushedEvents(logDir)
      const mismatch = requestEvent(events, 'release-mismatch')
      const partialRelease = requestEvent(events, 'release-partial')
      const replay = requestEvent(events, 'release-replay')
      const stableRelease = requestEvent(events, 'release-stable')

      expect(workspaceEditContext(mismatch)).not.toHaveProperty('destructiveAcknowledgement')
      expect(workspaceEditContext(partialRelease)).toMatchObject({
        destructiveAcknowledgement: {
          action: 'discard-partial-recovery',
          generation: failedRecovery.generation,
          unrecoveredPaths: failedRecovery.unrecoveredPaths,
        },
      })
      expect(workspaceEditContext(replay)).not.toHaveProperty('destructiveAcknowledgement')
      expect(workspaceEditContext(stableRelease)).not.toHaveProperty('destructiveAcknowledgement')
    } finally {
      await resetObservabilityForTests()
    }
  })

  it('lists partial recovery summaries after restart without exposing contents or staging paths', async () => {
    const failure = { failCompensation: true, failSecondForward: true, firstRenameCount: 0 }
    const fixture = await createFixture({
      driver: (workspaceRoot) => partialWriteDriver(workspaceRoot, failure),
    })
    const first = await seedFile(fixture, 'first.txt', 'secret-before')
    const second = await seedFile(fixture, 'second.txt', 'second-before')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        writeOperation(0, 'first.txt', first, 'secret-after'),
        writeOperation(1, 'second.txt', second, 'second-after'),
      ]),
    )
    const partial = await fixture.service.workspaceEditCommit(transition(prepared))
    const restarted = restartedService(fixture)

    try {
      const recovery = await restarted.workspaceEditRecovery('')
      expect(recovery.operations).toEqual([
        {
          generation: partial.generation,
          operationId: partial.operationId,
          recoveryTarget: 'rolled-back',
          unrecoveredPaths: ['first.txt'],
          workspace: '',
        },
      ])
      const serialized = JSON.stringify(recovery)
      expect(serialized).not.toContain('secret-before')
      expect(serialized).not.toContain('secret-after')
      expect(serialized).not.toContain(fixture.journalRoot)
      expect(serialized).not.toContain('stage/')
    } finally {
      await restarted.close()
    }
  })

  it('rejects a prepared create after its workspace root becomes an outside symlink', async () => {
    const fixture = await createFixture()
    const project = workspacePath(fixture, 'project')
    const outside = path.join(fixture.baseRoot, 'outside')
    await mkdir(project)
    await mkdir(outside)
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [createOperation(0, 'created.txt')], 'project'),
    )
    await rename(project, workspacePath(fixture, 'original-project'))
    await symlink(outside, project)

    const commit = fixture.service.workspaceEditCommit(transition(prepared))
    await commit.catch(() => {})
    expect(await readdir(outside)).toEqual([])
    await expect(commit).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_INVALID' })
    expect(await readManifest(fixture, prepared.operationId)).toMatchObject({ state: 'prepared' })
  })

  it('retains recovery data when its workspace root becomes an outside symlink', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'project/deleted.txt', 'original bytes')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [deleteOperation(0, 'deleted.txt', expected)], 'project'),
    )
    await fixture.service.workspaceEditCommit(transition(prepared))
    const project = workspacePath(fixture, 'project')
    const outside = path.join(fixture.baseRoot, 'outside')
    await mkdir(outside)
    await rename(project, workspacePath(fixture, 'original-project'))
    await symlink(outside, project)
    const restarted = restartedService(fixture)

    try {
      const status = await restarted.workspaceEditStatus(prepared.operationId)
      expect(await readdir(outside)).toEqual([])
      expect(status).toMatchObject({ found: true, result: { state: 'partial' } })
      const manifest = await readManifest(fixture, prepared.operationId)
      const reservedPath = manifest.legs[0]?.reservedPath
      expect(reservedPath).toEqual(expect.any(String))
      expect(
        await readFile(path.join(fixture.journalRoot, prepared.operationId, reservedPath!), 'utf8'),
      ).toBe('original bytes')
    } finally {
      await restarted.close()
    }
  })

  it('supports explicit ignored no-ops and rejects aliases symlinks and directories', async () => {
    const fixture = await createFixture()
    const existing = await seedFile(fixture, 'existing.txt', 'existing')
    const source = await seedFile(fixture, 'source.txt', 'source')
    const destination = await seedFile(fixture, 'destination.txt', 'destination')
    const noOps: readonly WorkspacePersistenceOperation[] = [
      {
        destination: existing,
        ignoreIfExists: true,
        index: 0,
        kind: 'create',
        overwrite: false,
        path: 'existing.txt',
      },
      {
        ...renameOperation(1, 'source.txt', 'destination.txt', source, destination, false),
        ignoreIfExists: true,
      },
      {
        ...deleteOperation(2, 'missing.txt', missingPrecondition()),
        ignoreIfNotExists: true,
      },
    ]
    await commitAndFinalize(
      fixture.service,
      await fixture.service.workspaceEditPrepare(prepareRequest(randomUUID(), noOps)),
    )
    expect(await readTexts(fixture, ['existing.txt', 'source.txt', 'destination.txt'])).toEqual([
      'existing',
      'source',
      'destination',
    ])

    const identical = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        renameOperation(0, 'source.txt', 'source.txt', source, source, false),
      ]),
    )
    await commitAndFinalize(fixture.service, identical)

    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [
          renameOperation(0, 'source.txt', 'SOURCE.txt', source, missingPrecondition(), false),
        ]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_INVALID' })

    await symlink('existing.txt', workspacePath(fixture, 'linked.txt'))
    await mkdir(workspacePath(fixture, 'folder'))
    await mkdir(workspacePath(fixture, 'real-folder'))
    const nested = await seedFile(fixture, 'real-folder/nested.txt', 'nested')
    await symlink('real-folder', workspacePath(fixture, 'linked-folder'))
    const fakeSnapshot = { kind: 'snapshot' as const, mtimeMs: 0, version: 'sha256:fake' }
    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [deleteOperation(0, 'linked.txt', fakeSnapshot)]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_INVALID' })
    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [deleteOperation(0, 'folder', fakeSnapshot)]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_INVALID' })
    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [deleteOperation(0, 'linked-folder/nested.txt', nested)]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_INVALID' })
    expect(await readText(fixture, 'real-folder/nested.txt')).toBe('nested')
  })

  it('allows a missing create across devices but rejects resource moves across them', async () => {
    const fixture = await createFixture({
      driver: (workspaceRoot, journalRoot) => splitDeviceDriver(workspaceRoot, journalRoot),
    })
    const created = await commitAndFinalize(
      fixture.service,
      await fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [createOperation(0, 'created.txt')]),
      ),
    )

    expect(created.state).toBe('finalized')
    expect(await readText(fixture, 'created.txt')).toBe('')

    const createdSnapshot = await snapshotPrecondition(fixture, 'created.txt')
    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [
          {
            ...createOperation(0, 'created.txt'),
            destination: createdSnapshot,
            overwrite: true,
          },
        ]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_DEVICE_UNSUPPORTED' })

    const source = await seedFile(fixture, 'source.txt', 'source')
    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [
          renameOperation(0, 'source.txt', 'renamed.txt', source, missingPrecondition(), false),
        ]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_DEVICE_UNSUPPORTED' })
    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [deleteOperation(0, 'source.txt', source)]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_DEVICE_UNSUPPORTED' })
  })

  it('executes overwrite cycle and explicit temp swap with reversible exact graphs', async () => {
    const cycle = await createFixture()
    const cycleA = await seedFile(cycle, 'a.txt', 'A')
    const cycleB = await seedFile(cycle, 'b.txt', 'B')
    const cycled = await commitAndFinalize(
      cycle.service,
      await cycle.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [
          renameOperation(0, 'a.txt', 'b.txt', cycleA, cycleB, true),
          renameOperation(
            1,
            'b.txt',
            'a.txt',
            transactionPrecondition(0),
            transactionPrecondition(0),
            true,
          ),
        ]),
      ),
    )
    expect(await readText(cycle, 'a.txt')).toBe('A')
    expect(await pathExists(workspacePath(cycle, 'b.txt'))).toBe(false)
    await undoAndFinalize(cycle.service, cycled)
    expect(await readTexts(cycle, ['a.txt', 'b.txt'])).toEqual(['A', 'B'])

    const swap = await createFixture()
    const swapA = await seedFile(swap, 'a.txt', 'A')
    const swapB = await seedFile(swap, 'b.txt', 'B')
    const swapped = await commitAndFinalize(
      swap.service,
      await swap.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [
          renameOperation(0, 'a.txt', 'temp.txt', swapA, missingPrecondition(), false),
          renameOperation(1, 'b.txt', 'a.txt', swapB, transactionPrecondition(0), false),
          renameOperation(
            2,
            'temp.txt',
            'b.txt',
            transactionPrecondition(0),
            transactionPrecondition(1),
            false,
          ),
        ]),
      ),
    )
    expect(await readTexts(swap, ['a.txt', 'b.txt'])).toEqual(['B', 'A'])
    await undoAndFinalize(swap.service, swapped)
    expect(await readTexts(swap, ['a.txt', 'b.txt'])).toEqual(['A', 'B'])
  })

  it('undo and redo reject after-version drift before mutation', async () => {
    const undoFixture = await createFixture()
    const undoExpected = await seedFile(undoFixture, 'file.txt', 'before')
    const undoStable = await commitAndFinalize(
      undoFixture.service,
      await undoFixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', undoExpected, 'after')]),
      ),
    )
    await writeFile(workspacePath(undoFixture, 'file.txt'), 'undo drift')
    await expect(
      undoFixture.service.workspaceEditUndo(transition(undoStable)),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_STALE' })
    expect(await readText(undoFixture, 'file.txt')).toBe('undo drift')

    const redoFixture = await createFixture()
    const redoExpected = await seedFile(redoFixture, 'file.txt', 'before')
    const redoStable = await commitAndFinalize(
      redoFixture.service,
      await redoFixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', redoExpected, 'after')]),
      ),
    )
    const undone = await undoAndFinalize(redoFixture.service, redoStable)
    await writeFile(workspacePath(redoFixture, 'file.txt'), 'redo drift')
    await expect(redoFixture.service.workspaceEditRedo(transition(undone))).rejects.toMatchObject({
      code: 'WORKSPACE_EDIT_STALE',
    })
    expect(await readText(redoFixture, 'file.txt')).toBe('redo drift')
  })

  it('recovers a crash between visible mutation and completion-marker fsync from inverse intent', async () => {
    const fixture = await createFixture()
    const expected = await seedFile(fixture, 'file.txt', 'before')
    const operationId = randomUUID()
    await fixture.service.workspaceEditPrepare(
      prepareRequest(operationId, [writeOperation(0, 'file.txt', expected, 'after')]),
    )
    const manifestPath = path.join(fixture.journalRoot, operationId, 'manifest.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as {
      activeTransition?: unknown
      legs: readonly [
        {
          afterStage: string
          beforeMode: number
          beforeMtimeMs: number
          beforeStage: string
          kind: 'write'
          path: string
        },
      ]
      [key: string]: unknown
    }
    const transitionId = randomUUID()
    manifest.activeTransition = {
      direction: 'forward',
      previousState: 'prepared',
      transitionId,
    }
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, { mode: 0o600 })
    const leg = manifest.legs[0]
    const intent = {
      after: [
        {
          exists: true,
          mode: leg.beforeMode,
          reference: 'workspace:file.txt',
          size: Buffer.byteLength('after'),
          version: textFileVersion('after'),
        },
      ],
      before: [
        {
          exists: true,
          reference: 'workspace:file.txt',
          size: Buffer.byteLength('before'),
          version: textFileVersion('before'),
        },
      ],
      direction: 'forward',
      step: {
        afterStage: leg.afterStage,
        beforeMode: leg.beforeMode,
        beforeMtimeMs: leg.beforeMtimeMs,
        beforeStage: leg.beforeStage,
        kind: 'write',
        path: leg.path,
      },
      stepIndex: 0,
      transitionId,
      type: 'intent',
    }
    await writeFile(
      path.join(fixture.journalRoot, operationId, 'program.jsonl'),
      `${JSON.stringify(intent)}\n`,
      { mode: 0o600 },
    )
    await writeFile(workspacePath(fixture, 'file.txt'), 'after')
    const restarted = restartedService(fixture)

    try {
      expect(await restarted.workspaceEditStatus(operationId)).toMatchObject({ found: false })
      expect(await readText(fixture, 'file.txt')).toBe('before')
      expect(await pathExists(path.join(fixture.journalRoot, operationId))).toBe(false)
    } finally {
      await restarted.close()
    }
  })

  it('startup aborts prepared and rolls back a committed provisional journal before serving', async () => {
    const preparedFixture = await createFixture()
    const preparedExpected = await seedFile(preparedFixture, 'file.txt', 'before')
    const prepared = await preparedFixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', preparedExpected, 'after')]),
    )
    const preparedRestart = restartedService(preparedFixture)
    try {
      expect(await preparedRestart.workspaceEditStatus(prepared.operationId)).toMatchObject({
        found: false,
      })
      expect(await readText(preparedFixture, 'file.txt')).toBe('before')
      expect(await pathExists(path.join(preparedFixture.journalRoot, prepared.operationId))).toBe(
        false,
      )
    } finally {
      await preparedRestart.close()
    }

    const committedFixture = await createFixture()
    const committedExpected = await seedFile(committedFixture, 'file.txt', 'before')
    const committedPrepared = await committedFixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', committedExpected, 'after')]),
    )
    const committed = await committedFixture.service.workspaceEditCommit(
      transition(committedPrepared),
    )
    expect(await readText(committedFixture, 'file.txt')).toBe('after')
    const committedRestart = restartedService(committedFixture)
    try {
      expect(await committedRestart.workspaceEditStatus(committed.operationId)).toMatchObject({
        found: false,
      })
      expect(await readText(committedFixture, 'file.txt')).toBe('before')
      expect(await pathExists(path.join(committedFixture.journalRoot, committed.operationId))).toBe(
        false,
      )
    } finally {
      await committedRestart.close()
    }
  })

  it('startup resource recovery retains only the untouched failed and later steps', async () => {
    const fixture = await createFixture()
    const destination = await seedFile(fixture, 'replace.txt', 'original bytes')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [
        {
          ...createOperation(0, 'replace.txt'),
          destination,
          overwrite: true,
        },
      ]),
    )
    const committed = await fixture.service.workspaceEditCommit(transition(prepared))
    expect(committed.state).toBe('committed')
    expect(await readText(fixture, 'replace.txt')).toBe('')
    const committedManifest = await readManifest(fixture, committed.operationId)
    expect(committedManifest.state).toBe('committed')
    const reservedPath = committedManifest.legs[0]?.reservedPath
    expect(reservedPath).toEqual(expect.any(String))
    expect(
      await pathExists(path.join(fixture.journalRoot, committed.operationId, reservedPath!)),
    ).toBe(true)

    const failure = { restoreAttempts: 0 }
    const restarted = restartedService(fixture, failingStartupResourceRestoreDriver(failure))
    try {
      const recovery = await restarted.workspaceEditRecovery('')
      expect(failure.restoreAttempts).toBe(1)
      expect(recovery.operations).toMatchObject([
        {
          operationId: committed.operationId,
          recoveryTarget: 'rolled-back',
          unrecoveredPaths: ['replace.txt'],
        },
      ])
      const manifest = await readManifest(fixture, committed.operationId)
      expect(manifest.recoveryProgram).toHaveLength(1)
      expect(manifest.recoveryProgram?.[0]).toMatchObject({
        direction: 'reverse',
        step: { kind: 'move' },
      })

      const summary = recovery.operations[0]!
      const recovered = await restarted.workspaceEditRecover({
        expectedGeneration: summary.generation,
        operationId: summary.operationId,
        recoveryTarget: summary.recoveryTarget,
        transitionId: randomUUID(),
      })
      expect(recovered.state).toBe('rolled-back')
      expect(await readText(fixture, 'replace.txt')).toBe('original bytes')
    } finally {
      await restarted.close()
    }
  })

  it('rejects one-operation quota before allocation', async () => {
    const fixture = await createFixture()
    const halfPlusOne = 64 * 1024 * 1024 + 1
    const before = 'a'.repeat(halfPlusOne)
    const after = 'b'.repeat(halfPlusOne)
    const expected = await seedFile(fixture, 'large.txt', before)
    const operationId = randomUUID()

    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(operationId, [writeOperation(0, 'large.txt', expected, after)]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_QUOTA' })
    expect(await pathExists(path.join(fixture.journalRoot, operationId))).toBe(false)
    expect(await readText(fixture, 'large.txt')).toBe(before)
  }, 15_000)

  it('lease expiry never interrupts a running transition', async () => {
    let now = 20_000
    const pause = deferred<void>()
    const entered = deferred<void>()
    const fixture = await createFixture({
      clock: () => now,
      driver: () => pausingCommitDriver(entered, pause),
    })
    const expected = await seedFile(fixture, 'file.txt', 'before')
    const other = await seedFile(fixture, 'other.txt', 'other')
    const prepared = await fixture.service.workspaceEditPrepare(
      prepareRequest(randomUUID(), [writeOperation(0, 'file.txt', expected, 'after')]),
    )
    const commit = fixture.service.workspaceEditCommit(transition(prepared))
    await entered.promise
    now += WORKSPACE_EDIT_LEASE_MS + 1

    await expect(
      fixture.service.workspaceEditPrepare(
        prepareRequest(randomUUID(), [writeOperation(0, 'other.txt', other, 'blocked')]),
      ),
    ).rejects.toMatchObject({ code: 'WORKSPACE_EDIT_BUSY' })
    pause.resolve()
    expect(await commit).toMatchObject({ state: 'committed' })
    expect(await readText(fixture, 'file.txt')).toBe('after')
  })
})

async function createFixture(options: FixtureOptions = {}): Promise<WorkspaceEditFixture> {
  const baseRoot = await mkdtemp(path.join(tmpdir(), 'platform-workspace-edit-test-'))
  const workspaceRoot = path.join(baseRoot, 'workspace')
  await mkdir(workspaceRoot)
  const journalRoot = options.journalInsideWorkspace
    ? path.join(workspaceRoot, 'journals-visible')
    : path.join(baseRoot, 'journals')
  const driver = options.driver?.(workspaceRoot, journalRoot)
  const service = new FileSystemService({
    metadataDatabasePath: ':memory:',
    watch: options.watch ?? false,
    watchBackend: 'node',
    workspaceEditClock: options.clock,
    workspaceEditDriver: driver,
    workspaceEditJournalRoot: journalRoot,
    workspaceRoot,
  })
  const fixture = { baseRoot, journalRoot, service, workspaceRoot }
  fixtures.push(fixture)
  return fixture
}

async function seedFile(
  fixture: WorkspaceEditFixture,
  relativePath: string,
  content: string,
): Promise<Extract<WorkspaceResourcePrecondition, { kind: 'snapshot' }>> {
  const target = workspacePath(fixture, relativePath)
  await mkdir(path.dirname(target), { recursive: true })
  await writeFile(target, content)
  const metadata = await stat(target)
  return { kind: 'snapshot', mtimeMs: metadata.mtimeMs, version: textFileVersion(content) }
}

async function snapshotPrecondition(
  fixture: WorkspaceEditFixture,
  relativePath: string,
): Promise<Extract<WorkspaceResourcePrecondition, { kind: 'snapshot' }>> {
  const target = workspacePath(fixture, relativePath)
  const [metadata, bytes] = await Promise.all([stat(target), readFile(target)])
  return {
    kind: 'snapshot',
    mtimeMs: metadata.mtimeMs,
    version: textFileVersion(bytes.toString('utf8')),
  }
}

function restartedService(
  fixture: WorkspaceEditFixture,
  workspaceEditDriver?: WorkspaceEditFileSystemDriver,
) {
  return new FileSystemService({
    metadataDatabasePath: ':memory:',
    watch: false,
    workspaceEditDriver,
    workspaceEditJournalRoot: fixture.journalRoot,
    workspaceRoot: fixture.workspaceRoot,
  })
}

function prepareRequest(
  operationId: string,
  operations: readonly WorkspacePersistenceOperation[],
  workspace = '',
): WorkspaceEditPrepareRequest {
  const bodyDigest = `sha256:${createHash('sha256').update(JSON.stringify({ operations, workspace })).digest('hex')}`
  return { bodyDigest, operationId, operations, origin: 'workspace-edit', workspace }
}

function writeOperation(
  index: number,
  relativePath: string,
  expected: Exclude<WorkspaceResourcePrecondition, { kind: 'missing' }>,
  text: string,
): Extract<WorkspacePersistenceOperation, { kind: 'write' }> {
  return { expected, index, kind: 'write', path: relativePath, text }
}

function createOperation(
  index: number,
  relativePath: string,
): Extract<WorkspacePersistenceOperation, { kind: 'create' }> {
  return {
    destination: missingPrecondition(),
    ignoreIfExists: false,
    index,
    kind: 'create',
    overwrite: false,
    path: relativePath,
  }
}

function renameOperation(
  index: number,
  oldPath: string,
  newPath: string,
  source: Exclude<WorkspaceResourcePrecondition, { kind: 'missing' }>,
  destination: WorkspaceResourcePrecondition,
  overwrite: boolean,
): Extract<WorkspacePersistenceOperation, { kind: 'rename' }> {
  return {
    destination,
    ignoreIfExists: false,
    index,
    kind: 'rename',
    newPath,
    oldPath,
    overwrite,
    source,
  }
}

function deleteOperation(
  index: number,
  relativePath: string,
  expected: WorkspaceResourcePrecondition,
): Extract<WorkspacePersistenceOperation, { kind: 'delete' }> {
  return {
    expected,
    ignoreIfNotExists: false,
    index,
    kind: 'delete',
    path: relativePath,
    recursive: false,
  }
}

function missingPrecondition(): Extract<WorkspaceResourcePrecondition, { kind: 'missing' }> {
  return { kind: 'missing' }
}

function transactionPrecondition(
  afterOperation: number,
): Extract<WorkspaceResourcePrecondition, { kind: 'transaction' }> {
  return { afterOperation, kind: 'transaction' }
}

function transition(result: WorkspaceEditResult): WorkspaceEditTransitionRequest {
  return {
    expectedGeneration: result.generation,
    operationId: result.operationId,
    transitionId: randomUUID(),
  }
}

async function commitAndFinalize(service: FileSystemService, prepared: WorkspaceEditResult) {
  const committed = await service.workspaceEditCommit(transition(prepared))
  return service.workspaceEditFinalize(transition(committed))
}

async function undoAndFinalize(service: FileSystemService, stable: WorkspaceEditResult) {
  const provisional = await service.workspaceEditUndo(transition(stable))
  return service.workspaceEditFinalize(transition(provisional))
}

async function redoAndFinalize(service: FileSystemService, undone: WorkspaceEditResult) {
  const provisional = await service.workspaceEditRedo(transition(undone))
  return service.workspaceEditFinalize(transition(provisional))
}

async function resourceSnapshot(
  fixture: WorkspaceEditFixture,
  relativePath: string,
): Promise<ResourceSnapshot> {
  const target = workspacePath(fixture, relativePath)
  const [metadata, bytes] = await Promise.all([lstat(target), readFile(target)])
  return {
    bytes,
    ino: metadata.ino,
    mode: metadata.mode,
    mtimeMs: metadata.mtimeMs,
    nlink: metadata.nlink,
    size: metadata.size,
  }
}

async function readManifest(fixture: WorkspaceEditFixture, operationId: string) {
  const bytes = await readFile(path.join(fixture.journalRoot, operationId, 'manifest.json'))
  return JSON.parse(bytes.toString('utf8')) as {
    legs: readonly { readonly reservedPath?: string }[]
    recoveryProgram?: readonly {
      readonly direction: 'forward' | 'reverse'
      readonly step: { readonly kind: string }
    }[]
    state?: string
  }
}

async function startEvents(service: FileSystemService): Promise<EventStream> {
  const abort = new AbortController()
  const events = service.events([''], abort.signal)[Symbol.asyncIterator]()
  expect((await events.next()).value).toMatchObject({ type: 'ready' })
  return { abort, events }
}

async function stopEvents(stream: EventStream) {
  stream.abort.abort()
  await stream.events.return?.()
}

async function nextEvent(events: AsyncIterator<WatchServerMessage>, timeoutMs = 250) {
  const result = await Promise.race([events.next(), delay(timeoutMs).then(() => undefined)])
  if (!result || result.done) return undefined
  return result.value
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms))
}

function observedFsApp(service: FileSystemService) {
  const app = new Elysia()
  applyObservability(app)
  return app.use(fsRoutes(service))
}

function postRelease(
  app: ReturnType<typeof observedFsApp>,
  body: WorkspaceEditReleaseRequest,
  requestId: string,
) {
  return app.handle(
    new Request('http://local/fs/workspace-edit/release', {
      body: JSON.stringify(body),
      headers: {
        'content-type': 'application/json',
        'x-request-id': requestId,
      },
      method: 'POST',
    }),
  )
}

async function flushedEvents(logDir: string) {
  await delay(0)
  await flushObservability()
  const events: WideEvent[] = []
  for await (const event of readFsLogs({ dir: logDir })) events.push(event)
  return events
}

function requestEvent(events: readonly WideEvent[], requestId: string) {
  const event = events.find((candidate) => candidate.requestId === requestId)
  expect(event).toBeDefined()
  return event!
}

function workspaceEditContext(event: WideEvent) {
  const context = event.workspaceEdit
  if (!context || typeof context !== 'object' || Array.isArray(context)) return {}
  return context as Record<string, unknown>
}

function testObservabilityEnv(logDir: string) {
  return {
    OBSERVABILITY_CONSOLE: 'false',
    OBSERVABILITY_DIR: logDir,
    OBSERVABILITY_ENABLED: 'true',
    OBSERVABILITY_INFO_SAMPLE_RATE: '100',
    NODE_ENV: 'production',
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

function pausingPrepareDriver(
  journalRoot: string,
  entered: ReturnType<typeof deferred<void>>,
  pause: ReturnType<typeof deferred<void>>,
): WorkspaceEditFileSystemDriver {
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async writeFile(target, data, options) {
      const shouldPause = target.startsWith(journalRoot) && target.endsWith('write-0-before')
      if (!shouldPause) return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)

      entered.resolve()
      await pause.promise
      return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)
    },
  }
}

function pausingCommitDriver(
  entered: ReturnType<typeof deferred<void>>,
  pause: ReturnType<typeof deferred<void>>,
): WorkspaceEditFileSystemDriver {
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async writeFile(target, data, options) {
      const basename = path.basename(target)
      const shouldPause = basename.startsWith('.file.txt.') && basename.endsWith('.tmp')
      if (!shouldPause) return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)

      entered.resolve()
      await pause.promise
      return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)
    },
  }
}

function observingResourceMoveDriver(
  _workspaceRoot: string,
  _journalRoot: string,
  observation: { intentSynced: boolean; resourceMoveObserved: boolean },
): WorkspaceEditFileSystemDriver {
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async open(target, flags, mode) {
      const handle = await nodeWorkspaceEditFileSystemDriver.open(target, flags, mode)
      if (!target.endsWith('program.jsonl') || flags !== 'a') return handle
      return observingHandle(handle, observation)
    },
    async rename(from, to) {
      const isResourceMove =
        path.basename(from) === 'destination.txt' &&
        to.includes(`${path.sep}stage${path.sep}resource-`)
      if (isResourceMove) {
        observation.resourceMoveObserved = true
        expect(observation.intentSynced).toBe(true)
      }
      return nodeWorkspaceEditFileSystemDriver.rename(from, to)
    },
  }
}

function observingHandle(
  handle: WorkspaceEditFileHandle,
  observation: { intentSynced: boolean },
): WorkspaceEditFileHandle {
  return {
    close: () => handle.close(),
    sync: async () => {
      await handle.sync()
      observation.intentSynced = true
    },
    writeFile: (data) => handle.writeFile(data),
  }
}

function splitDeviceDriver(
  workspaceRoot: string,
  journalRoot: string,
): WorkspaceEditFileSystemDriver {
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async lstat(target) {
      const stats = await nodeWorkspaceEditFileSystemDriver.lstat(target)
      stats.dev = simulatedDevice(target, workspaceRoot, journalRoot, stats.dev)
      return stats
    },
    async stat(target) {
      const stats = await nodeWorkspaceEditFileSystemDriver.stat(target)
      stats.dev = simulatedDevice(target, workspaceRoot, journalRoot, stats.dev)
      return stats
    },
  }
}

function simulatedDevice(
  target: string,
  workspaceRoot: string,
  journalRoot: string,
  fallback: number,
): number {
  if (target === workspaceRoot || target.startsWith(`${workspaceRoot}${path.sep}`)) return 101
  if (target === journalRoot || target.startsWith(`${journalRoot}${path.sep}`)) return 202
  return fallback
}

function failingStartupResourceRestoreDriver(failure: {
  restoreAttempts: number
}): WorkspaceEditFileSystemDriver {
  let shouldFail = true
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async rename(from, to) {
      const isRestore = path.basename(to) === 'replace.txt'
      if (!shouldFail || !isRestore) {
        return nodeWorkspaceEditFileSystemDriver.rename(from, to)
      }

      failure.restoreAttempts += 1
      shouldFail = false
      throw new FsError('OPERATION_FAILED')
    },
  }
}

function failingSecondWriteDriver(
  _workspaceRoot: string,
  failure: { failSecondForward: boolean },
): WorkspaceEditFileSystemDriver {
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async rename(from, to) {
      if (path.basename(to) === 'second.txt' && failure.failSecondForward) {
        failure.failSecondForward = false
        throw new FsError('OPERATION_FAILED')
      }
      return nodeWorkspaceEditFileSystemDriver.rename(from, to)
    },
  }
}

function partialWriteDriver(
  _workspaceRoot: string,
  failure: {
    failCompensation: boolean
    failSecondForward: boolean
    firstRenameCount: number
  },
): WorkspaceEditFileSystemDriver {
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async rename(from, to) {
      if (path.basename(to) === 'second.txt' && failure.failSecondForward) {
        failure.failSecondForward = false
        throw new FsError('OPERATION_FAILED')
      }
      if (path.basename(to) === 'first.txt') {
        failure.firstRenameCount += 1
        if (failure.firstRenameCount > 1 && failure.failCompensation) {
          throw new FsError('OPERATION_FAILED')
        }
      }
      return nodeWorkspaceEditFileSystemDriver.rename(from, to)
    },
  }
}

async function readText(fixture: WorkspaceEditFixture, relativePath: string) {
  return readFile(workspacePath(fixture, relativePath), 'utf8')
}

async function readTexts(fixture: WorkspaceEditFixture, relativePaths: readonly string[]) {
  return Promise.all(relativePaths.map((relativePath) => readText(fixture, relativePath)))
}

function workspacePath(fixture: WorkspaceEditFixture, relativePath: string) {
  return path.join(fixture.workspaceRoot, relativePath)
}

async function pathExists(target: string) {
  try {
    await lstat(target)
    return true
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
      return false
    }
    throw error
  }
}

async function collectSearchMatches(service: FileSystemService, query: string) {
  const matches: string[] = []
  for await (const event of service.searchEvents({
    includeContent: true,
    includeNames: false,
    limit: 50,
    matchMode: 'literal',
    path: '',
    query,
    useWorkspaceIndex: false,
  })) {
    if (event.type === 'match') matches.push(event.match.path)
  }
  return matches
}

async function waitForIndexReady(service: FileSystemService) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (service.workspaceIndex?.status().readiness === 'ready') return
    await delay(10)
  }
  expect(service.workspaceIndex?.status().readiness).toBe('ready')
}
