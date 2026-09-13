import { randomUUID } from 'node:crypto'
import { mkdir, mkdtemp, lstat, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { healthDescriptorSchema, ORCHESTRATION_WS_PROTOCOL_VERSION } from '@workspace/contracts'
import * as v from 'valibot'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { closeTestApps, createTestApp } from '../../test/server'
import { testSettingsOptions } from '../settings/testing'
import { textFileVersion } from '../fs/version'
import { FsError } from '../fs/errors'
import {
  nodeWorkspaceEditFileSystemDriver,
  type WorkspaceEditFileSystemDriver,
} from '../fs/workspace-edit-journal'

const TRUSTED_ORIGIN = 'http://localhost:5173'
const roots: string[] = []

afterEach(async () => {
  await closeTestApps()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('fs rpc auth', () => {
  it('returns a stable authenticated descriptor for each independent database', async () => {
    const first = testApp(await fixtureRoot())
    const second = testApp(await fixtureRoot())
    const healthRequest = () =>
      new Request('http://local/health', {
        headers: trustedOriginHeaders(),
      })
    const firstDescriptor = v.parse(
      healthDescriptorSchema,
      await (await first.handle(healthRequest())).json(),
    )
    const repeated = v.parse(
      healthDescriptorSchema,
      await (await first.handle(healthRequest())).json(),
    )
    const secondDescriptor = v.parse(
      healthDescriptorSchema,
      await (await second.handle(healthRequest())).json(),
    )

    expect(firstDescriptor).toMatchObject({
      ok: true,
      label: hostname(),
      protocolVersion: ORCHESTRATION_WS_PROTOCOL_VERSION,
      serverVersion: '0.0.1',
      platform: { os: process.platform, arch: process.arch },
    })
    expect(repeated.environmentId).toBe(firstDescriptor.environmentId)
    expect(secondDescriptor.environmentId).not.toBe(firstDescriptor.environmentId)
  })

  it('accepts trusted local app origins', async () => {
    const app = testApp(await fixtureRoot())
    const response = await app.handle(
      new Request('http://local/health', {
        headers: { origin: TRUSTED_ORIGIN },
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true })
  })

  it('rejects requests without an origin', async () => {
    const app = testApp(await fixtureRoot())
    const response = await app.handle(new Request('http://local/health'))

    expect(response.status).toBe(401)
    expect(await errorCode(response)).toBe('UNAUTHORIZED')
  })

  it('rejects disallowed origins', async () => {
    const app = testApp(await fixtureRoot())
    const response = await app.handle(
      new Request('http://local/health', {
        headers: { origin: 'http://evil.localhost' },
      }),
    )

    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe('FORBIDDEN_ORIGIN')
  })

  it('sets CORS headers for trusted origins', async () => {
    const app = testApp(await fixtureRoot())
    const response = await app.handle(
      new Request('http://local/health', {
        headers: { origin: TRUSTED_ORIGIN },
      }),
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('access-control-allow-origin')).toBe(TRUSTED_ORIGIN)
  })

  // The regression gate: before the exact-origin collapse this returned 200,
  // because dev-origin mode widened the allowlist to any loopback port.
  it('rejects a loopback origin that is not on the allowlist', async () => {
    const app = testApp(await fixtureRoot())
    const response = await app.handle(
      new Request('http://local/health', {
        headers: { origin: 'http://localhost:9999' },
      }),
    )

    expect(response.status).toBe(403)
    expect(await errorCode(response)).toBe('FORBIDDEN_ORIGIN')
    expect(response.headers.get('access-control-allow-origin')).toBeNull()
  })

  // localhost and 127.0.0.1 are different origins for the same socket, which is
  // why the launcher has to emit both spellings.
  it('accepts every launcher-listed spelling of the web origin', async () => {
    const app = testApp(await fixtureRoot(), {
      allowedOrigins: ['http://127.0.0.1:5173', 'http://localhost:5173'],
    })

    for (const origin of ['http://127.0.0.1:5173', 'http://localhost:5173']) {
      const response = await app.handle(new Request('http://local/health', { headers: { origin } }))

      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe(origin)
    }
  })
})

describe('fs rpc filesystem limits', () => {
  it('returns byte size mtime decoded content and content version for valid UTF-8', async () => {
    const root = await fixtureRoot()
    const content = 'héllo\n'
    await writeFile(path.join(root, 'utf8.txt'), content)
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/read?path=utf8.txt', {
        headers: trustedOriginHeaders(),
      }),
    )
    const result = (await response.json()) as Record<string, unknown>

    expect(response.status).toBe(200)
    expect(result).toMatchObject({
      content,
      path: 'utf8.txt',
      size: Buffer.byteLength(content),
      version: textFileVersion(content),
    })
    expect(result.mtimeMs).toEqual(expect.any(Number))
  })

  it('preserves one leading UTF-8 BOM as U+FEFF in decoded content and content version', async () => {
    const root = await fixtureRoot()
    const content = '\uFEFFhello'
    await writeFile(path.join(root, 'bom.txt'), content)
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/read?path=bom.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      content,
      size: Buffer.byteLength(content),
      version: textFileVersion(content),
    })
  })

  it('serves malformed UTF-8 as replacement characters and marks the read lossy', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'malformed.txt'), new Uint8Array([0x66, 0x80, 0x6f]))
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/read?path=malformed.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      content: 'f\uFFFDo',
      encoding: 'utf8',
      lossy: true,
      seemsBinary: false,
      size: 3,
    })
  })

  it('serves a NUL-bearing file as text and flags it as seeming binary', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'nul.txt'), 'left\0right')
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/read?path=nul.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      content: 'left\0right',
      // Valid UTF-8 throughout, so the bytes still round-trip even though it looks binary.
      lossy: false,
      seemsBinary: true,
    })
  })

  it('refuses a binary-looking file only when the caller asks for text only', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'nul.txt'), 'left\0right')
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/read?path=nul.txt&acceptTextOnly=true', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(415)
    expect(await errorCode(response)).toBe('FILE_IS_BINARY')
  })

  it('decodes a UTF-16 file instead of refusing it, and marks it lossy', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'utf16.txt'), Buffer.from('\uFEFFhello', 'utf16le'))
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/read?path=utf16.txt&acceptTextOnly=true', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      content: '\uFEFFhello',
      encoding: 'utf16le',
      // We only ever write UTF-8 back, so a UTF-16 source cannot round-trip through an edit.
      lossy: true,
      seemsBinary: false,
    })
  })

  it('never fails a read of a readable regular file, whatever its bytes', async () => {
    const root = await fixtureRoot()
    const bytes = new Uint8Array(1024)
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = index % 256
    await writeFile(path.join(root, 'random.bin'), bytes)
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/read?path=random.bin', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ seemsBinary: true, size: 1024 })
  })

  it('refuses to overwrite a file whose bytes do not round-trip as UTF-8', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'malformed.txt'), new Uint8Array([0x66, 0x80, 0x6f]))
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/write', {
        body: JSON.stringify({ content: 'f\uFFFDo', path: 'malformed.txt' }),
        headers: { ...trustedOriginHeaders(), 'content-type': 'application/json' },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('LOSSY_WRITE_BLOCKED')
    expect(await readFile(path.join(root, 'malformed.txt'))).toEqual(
      Buffer.from([0x66, 0x80, 0x6f]),
    )
  })

  it('allows overwriting a NUL-bearing file, because those bytes do round-trip', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'nul.txt'), 'left\0right')
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/write', {
        body: JSON.stringify({ content: 'edited', path: 'nul.txt' }),
        headers: { ...trustedOriginHeaders(), 'content-type': 'application/json' },
        method: 'POST',
      }),
    )

    expect(response.status).toBe(200)
    expect(await readFile(path.join(root, 'nul.txt'), 'utf8')).toBe('edited')
  })

  it('reports home as the default browsing path while keeping root selectable', async () => {
    const root = await fixtureRoot()
    const home = path.join(root, 'home')
    await mkdir(home, { recursive: true })
    const app = testApp(root, { homeDirectory: home })

    const health = await app.handle(
      new Request('http://local/health', {
        headers: trustedOriginHeaders(),
      }),
    )
    const tree = await app.handle(
      new Request('http://local/fs/tree?path=&depth=1', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      defaultPath: 'home',
      homePath: 'home',
      systemRoot: path.parse(home).root,
      workspaceRoot: root,
    })
    expect(tree.status).toBe(200)
    expect(await tree.json()).toMatchObject({ path: '' })
  })

  it('reports no boot-time index root, then the folder opened through the app', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'repo'), { recursive: true })
    const app = testApp(root, { watch: false })
    const before = await app.handle(
      new Request('http://local/health', { headers: trustedOriginHeaders() }),
    )

    expect(await before.json()).toMatchObject({
      workspaceIndex: {
        readiness: 'cold',
        scanRoot: null,
      },
    })

    const opened = await app.handle(
      new Request('http://local/fs/workspace-root', {
        body: JSON.stringify({ generation: 1, path: 'repo' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )
    expect(opened.status).toBe(200)

    const health = await app.handle(
      new Request('http://local/health', { headers: trustedOriginHeaders() }),
    )
    const payload = (await health.json()) as {
      workspaceIndex: { readiness: string; scanRoot: string | null }
    }

    expect(payload.workspaceIndex.scanRoot).toBe(path.join(root, 'repo'))
    expect(['cold', 'building', 'ready']).toContain(payload.workspaceIndex.readiness)
  })

  it('rejects text reads above the configured cap', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'large.txt'), '')
    await truncate(path.join(root, 'large.txt'), 6)
    const app = testApp(root, { maxTextFileBytes: 5 })
    const response = await app.handle(
      new Request('http://local/fs/read?path=large.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(413)
    expect(await errorCode(response)).toBe('FILE_TOO_LARGE')
  })

  it('applies the text size guard before malformed UTF-8 decoding', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'large-malformed.txt'), new Uint8Array([0x80, 0x80]))
    const app = testApp(root, { maxTextFileBytes: 1 })
    const response = await app.handle(
      new Request('http://local/fs/read?path=large-malformed.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(413)
    expect(await errorCode(response)).toBe('FILE_TOO_LARGE')
  })

  it('conflicts when a base-version write target disappeared', async () => {
    const root = await fixtureRoot()
    const app = testApp(root)
    const response = await app.handle(
      new Request('http://local/fs/write', {
        body: JSON.stringify({
          baseVersion: textFileVersion('before'),
          content: 'after',
          path: 'missing.txt',
        }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(response.status).toBe(409)
    expect(await errorCode(response)).toBe('FILE_CHANGED')
  })

  it('loads symlink directory targets through the tree API with the default root', async () => {
    const root = await fixtureRoot()
    const outside = await fixtureRoot()
    await mkdir(path.join(outside, 'target'), { recursive: true })
    await writeFile(path.join(outside, 'target', 'secret.txt'), 'hidden')
    await symlink(path.join(outside, 'target'), path.join(root, 'linked'))
    const app = createTestApp({
      auth: { allowedOrigins: [TRUSTED_ORIGIN] },
      settings: testSettingsOptions(root),
      watch: false,
    })
    const rootPath = path.relative(path.parse(root).root, root).replaceAll(path.sep, '/')
    const linkedPath = `${rootPath}/linked`

    const response = await app.handle(
      new Request(`http://local/fs/tree?${new URLSearchParams({ path: rootPath, depth: '2' })}`, {
        headers: trustedOriginHeaders(),
      }),
    )
    const payload = (await response.json()) as {
      entries: Array<{
        children?: Array<{ path: string; type: string }>
        path: string
        targetType?: string
        type: string
      }>
    }
    const linked = payload.entries.find((entry) => entry.path === linkedPath)

    expect(response.status).toBe(200)
    expect(linked).toMatchObject({
      path: linkedPath,
      targetType: 'directory',
      type: 'symlink',
    })
    expect(linked?.children).toContainEqual(
      expect.objectContaining({ path: `${linkedPath}/secret.txt`, type: 'file' }),
    )
    expect((await lstat(path.join(root, 'linked'))).isSymbolicLink()).toBe(true)
  })

  it('reads and writes symlink file targets without replacing the link with the default root', async () => {
    const root = await fixtureRoot()
    const outside = await fixtureRoot()
    const target = path.join(outside, 'target.txt')
    const linked = path.join(root, 'linked.txt')
    await writeFile(target, 'before')
    await symlink(target, linked)
    const app = createTestApp({
      auth: { allowedOrigins: [TRUSTED_ORIGIN] },
      settings: testSettingsOptions(root),
      watch: false,
    })
    const linkedPath = path.relative(path.parse(linked).root, linked).replaceAll(path.sep, '/')

    const read = await app.handle(
      new Request(`http://local/fs/read?${new URLSearchParams({ path: linkedPath })}`, {
        headers: trustedOriginHeaders(),
      }),
    )
    const written = await app.handle(
      new Request('http://local/fs/write', {
        body: JSON.stringify({ path: linkedPath, content: 'after' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(read.status).toBe(200)
    expect(await read.json()).toMatchObject({
      content: 'before',
      path: linkedPath,
    })
    expect(written.status).toBe(200)
    expect(await written.json()).toMatchObject({
      path: linkedPath,
      targetType: 'file',
      type: 'symlink',
    })
    expect(await readFile(target, 'utf8')).toBe('after')
    expect((await lstat(linked)).isSymbolicLink()).toBe(true)
  })

  it('filters ignored tree entries and keeps directory-first sorting', async () => {
    const root = await fixtureRoot()
    await Promise.all([
      mkdir(path.join(root, '.git'), { recursive: true }),
      mkdir(path.join(root, 'z-dir'), { recursive: true }),
      mkdir(path.join(root, 'a-dir'), { recursive: true }),
      writeFile(path.join(root, 'b.txt'), 'ok'),
      writeFile(path.join(root, 'a.txt'), 'ok'),
    ])
    const app = testApp(root)

    const response = await app.handle(
      new Request('http://local/fs/tree?path=&depth=1', {
        headers: trustedOriginHeaders(),
      }),
    )
    const payload = (await response.json()) as {
      entries: Array<{ path: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.entries.map((entry) => entry.path)).toEqual(['a-dir', 'z-dir', 'a.txt', 'b.txt'])
  })

  it('loads large directories through bounded concurrent stat reads', async () => {
    const root = await fixtureRoot()
    await Promise.all(
      Array.from({ length: 96 }, (_, index) =>
        writeFile(path.join(root, `file-${index}.txt`), 'ok'),
      ),
    )
    const app = testApp(root, { treeConcurrency: 4 })

    const response = await app.handle(
      new Request('http://local/fs/tree?path=&depth=1', {
        headers: trustedOriginHeaders(),
      }),
    )
    const payload = (await response.json()) as {
      entries: Array<{ path: string }>
    }

    expect(response.status).toBe(200)
    expect(payload.entries).toHaveLength(96)
  })

  it('reports native watcher state', async () => {
    const enabled = testApp(await fixtureRoot())
    const disabled = testApp(await fixtureRoot(), { watch: false })

    const enabledHealth = await enabled.handle(
      new Request('http://local/health', {
        headers: trustedOriginHeaders(),
      }),
    )
    const disabledHealth = await disabled.handle(
      new Request('http://local/health', {
        headers: trustedOriginHeaders(),
      }),
    )

    const enabledPayload = await enabledHealth.json()
    const disabledPayload = await disabledHealth.json()

    expect(enabledPayload).toMatchObject({
      watchEnabled: true,
      workspaceIndex: expect.objectContaining({
        readiness: expect.any(String),
      }),
    })
    expect(enabledPayload.nativeWatcherCount).toEqual(expect.any(Number))
    expect(disabledPayload).toMatchObject({
      nativeWatcherCount: 0,
      watchEnabled: false,
      workspaceIndex: expect.objectContaining({
        readiness: expect.any(String),
      }),
    })
  })

  it('keeps workspace indexing off for system-root browsing without a configured workspace', async () => {
    const root = await fixtureRoot()
    const app = createTestApp({
      auth: {
        allowedOrigins: [TRUSTED_ORIGIN],
      },
      homeDirectory: root,
      settings: testSettingsOptions(root),
      systemRoot: root,
    })

    const health = await app.handle(
      new Request('http://local/health', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      nativeWatcherCount: 0,
      watchEnabled: true,
      workspaceIndex: expect.objectContaining({
        entryCount: 0,
        readiness: 'cold',
        scanRoot: null,
      }),
      workspaceRoot: root,
    })
  })
})

describe('fs workspace edit rpc', () => {
  it('returns the shared route shape for a successful ordered transaction', async () => {
    const root = await fixtureRoot()
    const target = path.join(root, 'route.txt')
    await writeFile(target, 'before')
    const stats = await lstat(target)
    const app = testApp(root)
    const operationId = randomUUID()
    const prepared = await postWorkspaceEdit(app, 'prepare', {
      bodyDigest: `sha256:${'a'.repeat(64)}`,
      operationId,
      operations: [
        {
          expected: {
            kind: 'snapshot',
            mtimeMs: stats.mtimeMs,
            version: textFileVersion('before'),
          },
          index: 0,
          kind: 'write',
          path: 'route.txt',
          text: 'after',
        },
      ],
      origin: 'workspace-edit',
      workspace: '',
    })
    const committed = await postWorkspaceEdit(app, 'commit', {
      expectedGeneration: 1,
      operationId,
      transitionId: randomUUID(),
    })
    const finalized = await postWorkspaceEdit(app, 'finalize', {
      expectedGeneration: 2,
      operationId,
      transitionId: randomUUID(),
    })

    expect(prepared.status).toBe(200)
    expect(await prepared.json()).toMatchObject({
      affectedPaths: ['route.txt'],
      eventPublication: 'pending',
      generation: 1,
      operationId,
      state: 'prepared',
    })
    expect(committed.status).toBe(200)
    expect(await committed.json()).toMatchObject({ generation: 2, state: 'committed' })
    expect(finalized.status).toBe(200)
    const result = await finalized.json()
    expect(result).toMatchObject({
      entries: [expect.objectContaining({ exists: true, path: 'route.txt' })],
      eventPublication: 'published',
      generation: 3,
      state: 'finalized',
    })
    expect(JSON.stringify(result)).not.toMatch(/before|after|stage|\/private\//u)
  })

  it('returns a structured partial recovery payload instead of an rpc exception', async () => {
    const root = await fixtureRoot()
    const firstPath = path.join(root, 'first.txt')
    const secondPath = path.join(root, 'second.txt')
    await writeFile(firstPath, 'first-before')
    await writeFile(secondPath, 'second-before')
    const [firstStats, secondStats] = await Promise.all([lstat(firstPath), lstat(secondPath)])
    const driver = partialWriteFailureDriver(firstPath, secondPath)
    const app = testApp(root, { workspaceEditDriver: driver })
    const operationId = randomUUID()
    const prepared = await postWorkspaceEdit(app, 'prepare', {
      bodyDigest: `sha256:${'b'.repeat(64)}`,
      operationId,
      operations: [
        workspaceWriteOperation(0, 'first.txt', 'first-before', 'first-after', firstStats.mtimeMs),
        workspaceWriteOperation(
          1,
          'second.txt',
          'second-before',
          'second-after',
          secondStats.mtimeMs,
        ),
      ],
      origin: 'workspace-edit',
      workspace: '',
    })
    expect(prepared.status).toBe(200)

    const committed = await postWorkspaceEdit(app, 'commit', {
      expectedGeneration: 1,
      operationId,
      transitionId: randomUUID(),
    })
    const result = await committed.json()

    expect(committed.status).toBe(200)
    expect(result).toMatchObject({
      generation: 2,
      operationId,
      recoveryTarget: 'rolled-back',
      state: 'partial',
      unrecoveredPaths: ['first.txt'],
    })
    expect(JSON.stringify(result)).not.toMatch(/first-before|first-after|stage|\/private\//u)
  })

  it('cancels an in-flight prepare through the real route after paused staging resumes', async () => {
    const root = await fixtureRoot()
    const journalRoot = await fixtureRoot()
    const target = path.join(root, 'paused.txt')
    await writeFile(target, 'before')
    const stats = await lstat(target)
    const entered = deferred<void>()
    const resume = deferred<void>()
    const app = testApp(root, {
      workspaceEditDriver: pausingWorkspaceEditPrepareDriver(entered, resume),
      workspaceEditJournalRoot: journalRoot,
    })
    const operationId = randomUUID()
    const prepare = postWorkspaceEdit(app, 'prepare', {
      bodyDigest: `sha256:${'c'.repeat(64)}`,
      operationId,
      operations: [workspaceWriteOperation(0, 'paused.txt', 'before', 'after', stats.mtimeMs)],
      origin: 'workspace-edit',
      workspace: '',
    })
    await entered.promise

    const abort = postWorkspaceEdit(app, 'abort', {
      expectedGeneration: 0,
      operationId,
      transitionId: randomUUID(),
    })
    resume.resolve()
    const [prepareResponse, abortResponse] = await Promise.all([prepare, abort])
    const [prepareResult, abortResult] = await Promise.all([
      prepareResponse.json(),
      abortResponse.json(),
    ])

    expect(prepareResponse.status).toBe(200)
    expect(abortResponse.status).toBe(200)
    expect(prepareResult).toMatchObject({ generation: 1, operationId, state: 'aborted' })
    expect(abortResult).toEqual(prepareResult)
    expect(await readFile(target, 'utf8')).toBe('before')
    await expect(lstat(path.join(journalRoot, operationId))).rejects.toMatchObject({
      code: 'ENOENT',
    })

    const legacyWrite = await app.handle(
      new Request('http://local/fs/write', {
        body: JSON.stringify({ content: 'after abort', path: 'paused.txt' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )
    expect(legacyWrite.status).toBe(200)
    expect(await readFile(target, 'utf8')).toBe('after abort')
  })
})

describe('fs rpc search', () => {
  it('streams name matches with file metadata', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'metadata-target.ts'), 'needle')
    const app = testApp(root)
    const stream = await app.handle(
      new Request('http://local/fs/search/events?query=metadata&includeContent=false', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)
    const match = await events.next()

    expect(match).toMatchObject({
      match: {
        birthtimeMs: expect.any(Number),
        kind: 'name',
        mtimeMs: expect.any(Number),
        path: 'metadata-target.ts',
        size: 6,
        source: 'disk',
        type: 'file',
      },
    })
    await events.close()
  })
})

describe('fs rpc events', () => {
  it('delivers child path changes to parent path subscriptions', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'src'), { recursive: true })
    const app = testApp(root, { watch: false })
    const stream = await app.handle(
      new Request('http://local/fs/events?path=src', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)

    expect(await events.next()).toMatchObject({ type: 'ready' })

    const created = app.handle(
      new Request('http://local/fs/create-file', {
        body: JSON.stringify({ path: 'src/child.txt', content: 'ok' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(await events.next()).toMatchObject({
      path: 'src/child.txt',
      type: 'created',
    })
    expect((await created).status).toBe(200)
    await events.close()
  })

  it('includes entry metadata on changed events for existing files', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'file.txt'), 'before')
    const app = testApp(root, { watch: false })
    const stream = await app.handle(
      new Request('http://local/fs/events', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)

    expect(await events.next()).toMatchObject({ type: 'ready' })

    const changed = app.handle(
      new Request('http://local/fs/write', {
        body: JSON.stringify({ path: 'file.txt', content: 'after' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )
    const event = await events.next()

    expect(event).toMatchObject({
      entry: {
        name: 'file.txt',
        path: 'file.txt',
        size: 5,
        type: 'file',
      },
      path: 'file.txt',
      type: 'changed',
    })
    expect(typeof event.entry).toBe('object')
    expect(typeof (event.entry as Record<string, unknown>).mtimeMs).toBe('number')
    expect((await changed).status).toBe(200)
    await events.close()
  })

  it('does not include entry metadata on deleted events', async () => {
    const root = await fixtureRoot()
    const app = testApp(root, { watch: false })
    const stream = await app.handle(
      new Request('http://local/fs/events', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)

    expect(await events.next()).toMatchObject({ type: 'ready' })

    const created = await app.handle(
      new Request('http://local/fs/create-file', {
        body: JSON.stringify({ path: 'gone.txt', content: 'ok' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )
    expect(created.status).toBe(200)
    expect(await events.next()).toMatchObject({ type: 'created' })

    const deleted = app.handle(
      new Request('http://local/fs/delete', {
        body: JSON.stringify({ path: 'gone.txt' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )
    const event = await events.next()

    expect(event).toMatchObject({
      path: 'gone.txt',
      type: 'deleted',
    })
    expect(event).not.toHaveProperty('entry')
    expect((await deleted).status).toBe(200)
    await events.close()
  })

  it('filters ignored path changes out of event streams', async () => {
    const root = await fixtureRoot()
    await mkdir(path.join(root, 'node_modules'), { recursive: true })
    const app = testApp(root, { watch: false })
    const stream = await app.handle(
      new Request('http://local/fs/events', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)

    expect(await events.next()).toMatchObject({ type: 'ready' })

    const created = await app.handle(
      new Request('http://local/fs/create-file', {
        body: JSON.stringify({ path: 'node_modules/ignored.txt' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(created.status).toBe(200)

    // The ignored create must emit nothing. Drain deterministically by issuing a
    // visible create: since the stream is ordered, if the ignored create had
    // emitted it would arrive before this sentinel.
    const sentinel = await app.handle(
      new Request('http://local/fs/create-file', {
        body: JSON.stringify({ path: 'visible.txt' }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(sentinel.status).toBe(200)
    expect(await nextEvent(events)).toMatchObject({ path: 'visible.txt', type: 'created' })
    await events.close()
  })

  it('reports external file creations from the native watcher', async () => {
    const root = await fixtureRoot()
    const app = testApp(root)
    const stream = await app.handle(
      new Request('http://local/fs/events', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)

    await waitForNativeWatcher(events)

    await writeFile(path.join(root, 'external-create.txt'), 'ok')
    const event = await nextMatchingEvent(
      events,
      (candidate) => candidate.type === 'created' && candidate.path === 'external-create.txt',
    )

    expect(event).toMatchObject({
      entry: {
        name: 'external-create.txt',
        path: 'external-create.txt',
        size: 2,
        type: 'file',
      },
      path: 'external-create.txt',
      type: 'created',
    })
    await events.close()
  })

  it('reports external file updates from the native watcher', async () => {
    const root = await fixtureRoot()
    // Seed before the watcher exists, the way the deletion test does. Creating
    // and then updating a file through a live watcher puts both writes in one
    // inotify batch, which coalesces them into the single `created` event — so
    // the update this test is about would never arrive on its own.
    await writeFile(path.join(root, 'external-update.txt'), 'before')

    const app = testApp(root)
    const stream = await app.handle(
      new Request('http://local/fs/events', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)

    await waitForNativeWatcher(events)

    await writeFile(path.join(root, 'external-update.txt'), 'after')
    const event = await nextMatchingEvent(
      events,
      (candidate) => candidate.type === 'changed' && candidate.path === 'external-update.txt',
    )

    expect(event).toMatchObject({
      entry: {
        name: 'external-update.txt',
        path: 'external-update.txt',
        size: 5,
        type: 'file',
      },
      path: 'external-update.txt',
      type: 'changed',
    })
    await events.close()
  })

  it('reports external file deletions from the native watcher', async () => {
    const root = await fixtureRoot()
    await writeFile(path.join(root, 'external-delete.txt'), 'ok')
    const app = testApp(root)
    const stream = await app.handle(
      new Request('http://local/fs/events', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)

    await waitForNativeWatcher(events)

    await rm(path.join(root, 'external-delete.txt'))
    const event = await nextMatchingEvent(
      events,
      (candidate) => candidate.type === 'deleted' && candidate.path === 'external-delete.txt',
    )

    expect(event).toMatchObject({
      path: 'external-delete.txt',
      type: 'deleted',
    })
    expect(event).not.toHaveProperty('entry')
    await events.close()
  })

  it('filters ignored external path changes out of event streams', async () => {
    const root = await fixtureRoot()
    const app = testApp(root)
    const stream = await app.handle(
      new Request('http://local/fs/events', {
        headers: trustedOriginHeaders(),
      }),
    )
    const events = createSseReader(stream)

    await waitForNativeWatcher(events)

    await mkdir(path.join(root, 'node_modules'), { recursive: true })
    await writeFile(path.join(root, 'node_modules', 'ignored.txt'), 'ok')
    await mkdir(path.join(root, 'logs'), { recursive: true })
    await writeFile(path.join(root, 'logs', '2026-05-25.jsonl'), '{}\n')

    // The ignored external changes must emit nothing, and a visible write is the
    // sentinel that proves the watcher got that far. Linux delivers a burst of
    // writes as one coalesced batch, so the sentinel needs its own batch or its
    // event is merged into an ignored one and never surfaces at all.
    await settleWatcher()

    await writeFile(path.join(root, 'visible.txt'), 'ok')
    // Drain rather than demanding the sentinel be first: batching decides the
    // order, so a leak is "an ignored path appeared", not "it appeared early".
    const event = await nextMatchingEvent(events, (candidate) => {
      expect(candidate.path).not.toMatch(/^(node_modules|logs)\//)
      return candidate.path === 'visible.txt'
    })

    expect(event).toMatchObject({ path: 'visible.txt' })
    await events.close()
  })
})

describe('git rpc', () => {
  it('reports status, diffs, and staged files', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'tracked.txt'), 'before\n')
    await runGit(root, ['add', 'tracked.txt'])
    await runGit(root, ['commit', '-m', 'initial'])
    await writeFile(path.join(root, 'tracked.txt'), 'after\n')
    await writeFile(path.join(root, 'new.txt'), 'new\n')
    const app = testApp(root)

    const status = await app.handle(
      new Request('http://local/git/status', {
        headers: trustedOriginHeaders(),
      }),
    )
    const diff = await app.handle(
      new Request('http://local/git/diff?path=tracked.txt', {
        headers: trustedOriginHeaders(),
      }),
    )
    const untrackedDiff = await app.handle(
      new Request('http://local/git/diff?path=new.txt', {
        headers: trustedOriginHeaders(),
      }),
    )
    const staged = await app.handle(
      new Request('http://local/git/stage', {
        body: JSON.stringify({ paths: ['tracked.txt'] }),
        headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
        method: 'POST',
      }),
    )

    expect(status.status).toBe(200)
    const statusPayload = (await status.json()) as GitStatusTestPayload
    expect(statusPayload.repository).toMatchObject({ path: '' })
    expect(statusPayload.files).toContainEqual(
      expect.objectContaining({ path: 'new.txt', status: 'untracked' }),
    )
    expect(statusPayload.files).toContainEqual(
      expect.objectContaining({ path: 'tracked.txt', status: 'modified' }),
    )
    expect(diff.status).toBe(200)
    const diffPayload = (await diff.json()) as GitDiffTestPayload
    expect(diffPayload).toMatchObject([
      {
        path: 'tracked.txt',
        staged: false,
        hunks: [
          {
            changes: [
              { oldLine: 1, text: 'before', type: 'deleted' },
              { newLine: 1, text: 'after', type: 'added' },
            ],
          },
        ],
      },
    ])
    expect(diffPayload[0].oldObjectId).toEqual(expect.any(String))
    expect(diffPayload[0].newObjectId).toEqual(expect.any(String))
    expect(diffPayload[0].oldText).toBeUndefined()
    expect(diffPayload[0].newText).toBeUndefined()
    expect(untrackedDiff.status).toBe(200)
    const untrackedDiffPayload = (await untrackedDiff.json()) as GitDiffTestPayload
    expect(untrackedDiffPayload).toMatchObject([
      {
        oldFileMissing: true,
        path: 'new.txt',
        staged: false,
        hunks: [
          {
            changes: [{ newLine: 1, text: 'new', type: 'added' }],
          },
        ],
      },
    ])
    expect(untrackedDiffPayload[0].oldText).toBeUndefined()
    expect(untrackedDiffPayload[0].newText).toBeUndefined()
    expect(staged.status).toBe(200)
    const stagedPayload = (await staged.json()) as GitStatusTestPayload
    expect(stagedPayload.files).toContainEqual(
      expect.objectContaining({ path: 'new.txt', status: 'untracked' }),
    )
    expect(stagedPayload.files).toContainEqual(
      expect.objectContaining({
        index: 'modified',
        path: 'tracked.txt',
        status: 'modified',
        worktree: 'unmodified',
      }),
    )
  })

  it('renders staged blob snapshots after the index changes', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'tracked.txt'), 'before\n')
    await runGit(root, ['add', 'tracked.txt'])
    await runGit(root, ['commit', '-m', 'initial'])
    await writeFile(path.join(root, 'tracked.txt'), 'after\n')
    await runGit(root, ['add', 'tracked.txt'])
    const app = testApp(root)

    const live = await app.handle(
      new Request('http://local/git/diff?path=tracked.txt&staged=true', {
        headers: trustedOriginHeaders(),
      }),
    )
    expect(live.status).toBe(200)
    const [snapshot] = (await live.json()) as GitDiffTestPayload
    await runGit(root, ['restore', '--staged', 'tracked.txt'])

    const stale = await app.handle(
      new Request(`http://local/git/diff/blob?${blobDiffParams(snapshot)}`, {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(stale.status).toBe(200)
    expect(await stale.json()).toMatchObject([
      {
        newObjectId: snapshot.newObjectId,
        oldObjectId: snapshot.oldObjectId,
        newText: 'after\n',
        oldText: 'before\n',
        path: 'tracked.txt',
        hunks: [
          {
            changes: [
              { oldLine: 1, text: 'before', type: 'deleted' },
              { newLine: 1, text: 'after', type: 'added' },
            ],
          },
        ],
      },
    ])
  })

  it('skips snapshot refs for binary and large live diffs', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'binary.dat'), new Uint8Array([0, 1, 2]))
    await writeFile(path.join(root, 'large.txt'), 'one\n')
    await runGit(root, ['add', 'binary.dat', 'large.txt'])
    await runGit(root, ['commit', '-m', 'initial'])
    await writeFile(path.join(root, 'binary.dat'), new Uint8Array([0, 1, 3]))
    await writeFile(path.join(root, 'large.txt'), 'larger\n')
    const app = testApp(root, { maxTextFileBytes: 5 })

    const binary = await app.handle(
      new Request('http://local/git/diff?path=binary.dat', {
        headers: trustedOriginHeaders(),
      }),
    )
    const large = await app.handle(
      new Request('http://local/git/diff?path=large.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(binary.status).toBe(200)
    const [binaryDiff] = (await binary.json()) as GitDiffTestPayload
    expect(binaryDiff.path).toBe('binary.dat')
    expect(binaryDiff.hunks).toEqual([])
    expect(binaryDiff.oldObjectId).toBeUndefined()
    expect(binaryDiff.newObjectId).toBeUndefined()
    expect(binaryDiff.oldText).toBeUndefined()
    expect(binaryDiff.newText).toBeUndefined()

    expect(large.status).toBe(200)
    const [largeDiff] = (await large.json()) as GitDiffTestPayload
    expect(largeDiff.path).toBe('large.txt')
    expect(largeDiff.hunks.length).toBeGreaterThan(0)
    expect(largeDiff.oldObjectId).toBeUndefined()
    expect(largeDiff.newObjectId).toBeUndefined()
    expect(largeDiff.oldText).toBeUndefined()
    expect(largeDiff.newText).toBeUndefined()
  })

  it('skips untracked files above the text diff limit', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'large.txt'), 'larger\n')
    const app = testApp(root, { maxTextFileBytes: 5 })

    const response = await app.handle(
      new Request('http://local/git/diff?path=large.txt', {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('omits blob text when the opened snapshot exceeds the text limit', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'old.txt'), 'one\n')
    await writeFile(path.join(root, 'new.txt'), 'larger\n')
    const oldObject = await runGit(root, ['hash-object', '-w', 'old.txt'])
    const newObject = await runGit(root, ['hash-object', '-w', 'new.txt'])
    const params = new URLSearchParams({
      newObjectId: newObject.stdout.trim(),
      oldObjectId: oldObject.stdout.trim(),
      path: 'large.txt',
    })
    const app = testApp(root, { maxTextFileBytes: 5 })

    const response = await app.handle(
      new Request(`http://local/git/diff/blob?${params}`, {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(response.status).toBe(200)
    const [diff] = (await response.json()) as GitDiffTestPayload
    expect(diff.hunks.length).toBeGreaterThan(0)
    expect(diff.oldObjectId).toBe(oldObject.stdout.trim())
    expect(diff.newObjectId).toBe(newObject.stdout.trim())
    expect(diff.oldText).toBeUndefined()
    expect(diff.newText).toBeUndefined()
  })

  it('renders unstaged blob snapshots after the worktree changes again', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'tracked.txt'), 'before\n')
    await runGit(root, ['add', 'tracked.txt'])
    await runGit(root, ['commit', '-m', 'initial'])
    await writeFile(path.join(root, 'tracked.txt'), 'after\n')
    const app = testApp(root)

    const live = await app.handle(
      new Request('http://local/git/diff?path=tracked.txt', {
        headers: trustedOriginHeaders(),
      }),
    )
    expect(live.status).toBe(200)
    const [snapshot] = (await live.json()) as GitDiffTestPayload
    await writeFile(path.join(root, 'tracked.txt'), 'later\n')

    const stale = await app.handle(
      new Request(`http://local/git/diff/blob?${blobDiffParams(snapshot)}`, {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(stale.status).toBe(200)
    expect(await stale.json()).toMatchObject([
      {
        path: 'tracked.txt',
        hunks: [
          {
            changes: [
              { oldLine: 1, text: 'before', type: 'deleted' },
              { newLine: 1, text: 'after', type: 'added' },
            ],
          },
        ],
      },
    ])
  })

  it('renders untracked blob snapshots after the file is deleted', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'new.txt'), 'new\n')
    const app = testApp(root)

    const live = await app.handle(
      new Request('http://local/git/diff?path=new.txt', {
        headers: trustedOriginHeaders(),
      }),
    )
    expect(live.status).toBe(200)
    const [snapshot] = (await live.json()) as GitDiffTestPayload
    await rm(path.join(root, 'new.txt'))

    const stale = await app.handle(
      new Request(`http://local/git/diff/blob?${blobDiffParams(snapshot)}`, {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(stale.status).toBe(200)
    expect(await stale.json()).toMatchObject([
      {
        oldFileMissing: true,
        path: 'new.txt',
        hunks: [
          {
            changes: [{ newLine: 1, text: 'new', type: 'added' }],
          },
        ],
      },
    ])
  })

  it('sends the whole file for a rename with no content change', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'old.txt'), 'one\ntwo\nthree\n')
    await runGit(root, ['add', 'old.txt'])
    await runGit(root, ['commit', '-m', 'initial'])
    await runGit(root, ['mv', 'old.txt', 'new.txt'])
    const app = testApp(root)

    const live = await app.handle(
      new Request('http://local/git/diff?path=new.txt&staged=true', {
        headers: trustedOriginHeaders(),
      }),
    )
    const [snapshot] = (await live.json()) as GitDiffTestPayload

    const blob = await app.handle(
      new Request(`http://local/git/diff/blob?${blobDiffParams(snapshot)}`, {
        headers: trustedOriginHeaders(),
      }),
    )

    // Identical blobs make an empty patch, so there is no entry to parse out of it. The viewer
    // still opened a file, and text on both sides is what lets it draw one instead of a sentence.
    expect(blob.status).toBe(200)
    expect(await blob.json()).toMatchObject([
      {
        hunks: [],
        newText: 'one\ntwo\nthree\n',
        oldPath: 'old.txt',
        oldText: 'one\ntwo\nthree\n',
        path: 'new.txt',
      },
    ])
  })

  it('renders deletion and rename blob snapshots with stable paths', async () => {
    const root = await fixtureRoot()
    await initGitRepository(root)
    await writeFile(path.join(root, 'old.txt'), 'one\ntwo\nthree\nfour\n')
    await writeFile(path.join(root, 'deleted.txt'), 'gone\n')
    await runGit(root, ['add', 'old.txt'])
    await runGit(root, ['add', 'deleted.txt'])
    await runGit(root, ['commit', '-m', 'initial'])
    await runGit(root, ['mv', 'old.txt', 'new.txt'])
    await writeFile(path.join(root, 'new.txt'), 'one\nTWO\nthree\nfour\n')
    await runGit(root, ['add', 'new.txt'])
    await rm(path.join(root, 'deleted.txt'))
    const app = testApp(root)

    const rename = await app.handle(
      new Request('http://local/git/diff?path=new.txt&staged=true', {
        headers: trustedOriginHeaders(),
      }),
    )
    const deletion = await app.handle(
      new Request('http://local/git/diff?path=deleted.txt', {
        headers: trustedOriginHeaders(),
      }),
    )
    const [renameSnapshot] = (await rename.json()) as GitDiffTestPayload
    const [deletionSnapshot] = (await deletion.json()) as GitDiffTestPayload

    const staleRename = await app.handle(
      new Request(`http://local/git/diff/blob?${blobDiffParams(renameSnapshot)}`, {
        headers: trustedOriginHeaders(),
      }),
    )
    const staleDeletion = await app.handle(
      new Request(`http://local/git/diff/blob?${blobDiffParams(deletionSnapshot)}`, {
        headers: trustedOriginHeaders(),
      }),
    )

    expect(staleRename.status).toBe(200)
    expect(await staleRename.json()).toMatchObject([{ oldPath: 'old.txt', path: 'new.txt' }])
    expect(staleDeletion.status).toBe(200)
    expect(await staleDeletion.json()).toMatchObject([
      { newFileMissing: true, path: 'deleted.txt' },
    ])
  })
})

type GitStatusTestPayload = {
  repository: { branch: string | null; path: string } | null
  files: Array<Record<string, unknown>>
}

type GitDiffTestPayload = Array<{
  hunks: Array<Record<string, unknown>>
  newObjectId?: string
  newText?: string
  oldObjectId?: string
  oldText?: string
  oldPath?: string
  path: string
}>

function blobDiffParams(diff: GitDiffTestPayload[number]) {
  const params = new URLSearchParams({ path: diff.path })
  if (diff.oldPath) params.set('oldPath', diff.oldPath)
  if (diff.oldObjectId) params.set('oldObjectId', diff.oldObjectId)
  if (diff.newObjectId) params.set('newObjectId', diff.newObjectId)

  return params
}

function testApp(
  root: string,
  options: {
    homeDirectory?: string
    maxTextFileBytes?: number
    allowedOrigins?: readonly string[]
    treeConcurrency?: number
    watch?: boolean
    watchBackend?: 'auto' | 'node'
    workspaceEditDriver?: WorkspaceEditFileSystemDriver
    workspaceEditJournalRoot?: string
  } = {},
) {
  const app = createTestApp({
    auth: {
      allowedOrigins: options.allowedOrigins ?? [TRUSTED_ORIGIN],
    },
    homeDirectory: options.homeDirectory,
    maxTextFileBytes: options.maxTextFileBytes,
    settings: testSettingsOptions(root),
    treeConcurrency: options.treeConcurrency,
    watch: options.watch,
    watchBackend: options.watchBackend ?? 'node',
    workspaceEditDriver: options.workspaceEditDriver,
    workspaceEditJournalRoot: options.workspaceEditJournalRoot,
    workspaceRoot: root,
  })
  return app
}

function postWorkspaceEdit(
  app: ReturnType<typeof createTestApp>,
  route: 'abort' | 'commit' | 'finalize' | 'prepare',
  body: object,
) {
  return app.handle(
    new Request(`http://local/fs/workspace-edit/${route}`, {
      body: JSON.stringify(body),
      headers: trustedOriginHeaders({ 'content-type': 'application/json' }),
      method: 'POST',
    }),
  )
}

function pausingWorkspaceEditPrepareDriver(
  entered: ReturnType<typeof deferred<void>>,
  resume: ReturnType<typeof deferred<void>>,
): WorkspaceEditFileSystemDriver {
  let shouldPause = true
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async writeFile(target, data, options) {
      if (!shouldPause || !target.endsWith('write-0-before')) {
        return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)
      }

      shouldPause = false
      entered.resolve()
      await resume.promise
      return nodeWorkspaceEditFileSystemDriver.writeFile(target, data, options)
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  const promise = new Promise<T>((resolver) => {
    resolve = resolver
  })
  return { promise, resolve }
}

function workspaceWriteOperation(
  index: number,
  relativePath: string,
  before: string,
  after: string,
  mtimeMs: number,
) {
  return {
    expected: { kind: 'snapshot', mtimeMs, version: textFileVersion(before) },
    index,
    kind: 'write',
    path: relativePath,
    text: after,
  }
}

function partialWriteFailureDriver(
  firstPath: string,
  secondPath: string,
): WorkspaceEditFileSystemDriver {
  let firstReplacementCount = 0
  return {
    ...nodeWorkspaceEditFileSystemDriver,
    async rename(from, to) {
      if (path.basename(to) === path.basename(secondPath)) throw new FsError('OPERATION_FAILED')
      if (path.basename(to) !== path.basename(firstPath)) {
        return nodeWorkspaceEditFileSystemDriver.rename(from, to)
      }

      firstReplacementCount += 1
      if (firstReplacementCount > 1) throw new FsError('OPERATION_FAILED')
      return nodeWorkspaceEditFileSystemDriver.rename(from, to)
    },
  }
}

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), 'platform-'))
  roots.push(root)
  return root
}

async function initGitRepository(root: string) {
  await runGit(root, ['init'])
  await runGit(root, ['config', 'user.email', 'test@example.com'])
  await runGit(root, ['config', 'user.name', 'Test User'])
}

async function runGit(root: string, args: readonly string[]) {
  const process = Bun.spawn(['git', '-C', root].concat(args), {
    stderr: 'pipe',
    stdout: 'pipe',
  })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ])
  if (exitCode === 0) return { stderr, stdout }

  throw new Error(`${stderr}${stdout}`.trim())
}

function trustedOriginHeaders(headers: HeadersInit = {}) {
  return {
    ...headers,
    origin: TRUSTED_ORIGIN,
  }
}

async function errorCode(response: Response) {
  const payload = (await response.json()) as { error: { code: string } }
  return payload.error.code
}

function createSseReader(response: Response) {
  if (!response.body) throw new Error('missing event stream body')

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffered = ''

  return {
    close: () => reader.cancel(),
    next: async () => {
      while (true) {
        const event = shiftSseEvent()
        if (event) return event

        const chunk = await reader.read()
        if (chunk.done) throw new Error('event stream ended')
        buffered += decodeSseChunk(decoder, chunk.value)
      }
    },
  }

  function shiftSseEvent() {
    const separator = buffered.indexOf('\n\n')
    if (separator < 0) return null

    const raw = buffered.slice(0, separator)
    buffered = buffered.slice(separator + 2)
    return parseSsePayload(raw)
  }
}

function decodeSseChunk(decoder: TextDecoder, value: unknown) {
  if (typeof value === 'string') return value

  return decoder.decode(value as BufferSource, { stream: true })
}

function parseSsePayload(raw: string) {
  const data = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')

  return JSON.parse(data) as Record<string, unknown>
}

// Guards against a watcher that never delivers, not against a slow one — a cold
// CI runner takes well past 2.5s to hand over the first event.
const FS_EVENT_TIMEOUT_MS = 15_000

async function nextMatchingEvent(
  events: ReturnType<typeof createSseReader>,
  matches: (event: Record<string, unknown>) => boolean,
) {
  const deadline = Date.now() + FS_EVENT_TIMEOUT_MS

  while (Date.now() < deadline) {
    const event = await Promise.race([
      events.next(),
      delay(Math.max(1, deadline - Date.now())).then(() => null),
    ])
    if (!event) break
    if (matches(event)) return event
  }

  throw new Error('timed out waiting for matching filesystem event')
}

// Lets the watcher flush the writes made so far, so the next write starts a new
// coalescing batch instead of being merged into the previous one.
function settleWatcher() {
  return delay(250)
}

async function waitForNativeWatcher(events: ReturnType<typeof createSseReader>) {
  expect(await events.next()).toMatchObject({ type: 'ready' })
  // FSEvents can merge a mutation into the batch that attached the watcher.
  await delay(50)
}

async function nextEvent(events: ReturnType<typeof createSseReader>) {
  const event = await Promise.race([events.next(), delay(FS_EVENT_TIMEOUT_MS).then(() => null)])
  if (!event) throw new Error('timed out waiting for filesystem event')

  return event
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
