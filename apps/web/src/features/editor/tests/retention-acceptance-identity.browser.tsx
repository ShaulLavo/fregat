import { expect, test, vi, type TestContext } from 'vitest'
import { commands, userEvent, page } from 'vitest/browser'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { tabFileResource } from '@/lib/documents/utils/capabilities'
import { createClientInvariantError } from '@/lib/structured-errors'
import { filesystemPath, fileDocumentKey } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery } from '@/lib/file-snapshot-query-cache'
import { readSettingsMirror } from '@/lib/settings-boot-mirror'
import { clientForQueryClient } from '@/lib/environments/state/query-clients'
import { statPath, createFileContent, deletePath } from '@/lib/file-server'
import { runMutation } from '@/lib/mutations/run'
import { fileSystemKeys } from '@/lib/query-keys'
import {
  fileOperationDocuments,
  runFileOperation,
  reverseLatestFileOperation,
} from '@/features/workspace/state/file-operations'
import { previewEditorTheme } from '@/features/editor/state/color-theme-store'
import { installEditorPerformanceTraceFromUrl } from '@/features/editor/state/performance-trace'
import { awaitEditorSyntaxWorkerIdleFences } from '@/features/editor/state/syntax-highlighting'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import { RetentionIdentityEntry } from '../../../../test/factories/retention-acceptance-identity-entry'
import { holdRetentionIdentityWorkerReply } from '../../../../test/factories/retention-acceptance-identity-worker'
import {
  retentionIdentityInput,
  retentionIdentityReference,
  calibrateRetentionIdentityOracle,
} from '../../../../test/factories/retention-acceptance-identity-paint'
import {
  captureRetentionAcceptancePaint,
  awaitRetentionAcceptanceReady,
  retentionAcceptanceSubject,
  assertRetentionAcceptancePaint,
} from '../../../../test/factories/retention-acceptance-paint'
import { tokenPaintMismatch } from '../../../../../../scripts/agent/scenarios/editor-tab-hover-highlights-probe'

const sourcePath = filesystemPath('repo/src/editor-tab-a.ts')
const cases = [
  { family: 'shiki', axis: 'theme' },
  { family: 'tree-sitter', axis: 'theme' },
  { family: 'shiki', axis: 'language' },
  { family: 'tree-sitter', axis: 'language' },
  { family: 'shiki', axis: 'provider' },
  { family: 'tree-sitter', axis: 'provider' },
  { family: 'shiki', axis: 'configuration' },
  { family: 'tree-sitter', axis: 'configuration' },
] as const

test.for(cases)(
  '$family held native reply across application $axis change',
  { timeout: 45_000 },
  async ({ family, axis }, context) => {
    installTrace(context)
    const gate = holdRetentionIdentityWorkerReply()
    const app = await mountRetentionAcceptanceApp(
      [],
      'surfaces',
      <RetentionIdentityEntry filesystem={axis === 'language'} />,
    )
    const initialPath =
      axis === 'language' ? filesystemPath(`repo/src/identity-language-${family}.ts`) : sourcePath
    const cleanupLanguageFixture =
      axis === 'language' ? await createLanguageFixture(app, initialPath, context) : null
    await ensureFileSnapshotQuery(app.queryClient, initialPath)
    expect(await app.read().commands.openFileSurface(initialPath)).toMatchObject({
      status: 'applied',
    })
    await awaitRetentionAcceptanceReady(app, initialPath)
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
    expect(tab).not.toBeNull()
    if (!tab) return
    const controller = app.read().ui.getState().controllersByTabId.get(tab.id)
    expect(controller).toBeDefined()
    if (!controller) return
    const initialInput = retentionIdentityInput(app, initialPath)
    const initial = await retentionIdentityReference(initialInput)
    const initialSample = captureRetentionAcceptancePaint(app, initialPath, tab.id)
    assertRetentionAcceptancePaint(initialSample, initial, initialPath)
    const controls = calibrateRetentionIdentityOracle(initialSample, initial)
    await context.annotate(
      JSON.stringify({ initialInput, initial, initialSample, controls }),
      'identity-known-good-calibration',
    )
    gate.arm('edit', family)
    controller.commands.edit({ from: 0, to: 0, text: '// held identity response\n' })
    await expect.poll(() => gate.held().length).toBe(1)
    let path = initialPath
    const observations: {
      readonly phase: string
      readonly path: ReturnType<typeof filesystemPath>
      readonly input: ReturnType<typeof retentionIdentityInput>
      readonly sample: ReturnType<typeof captureRetentionAcceptancePaint>
      readonly capturedPaint:
        | ReturnType<NonNullable<ReturnType<typeof controller.getEditor>>['captureSnapshot']>
        | undefined
    }[] = []
    let phase = 'held-before-change'
    let recording = true
    let handle = 0
    const record = () => {
      if (!recording) return
      const selected = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
      const activePath = tabFileResource(selected?.content)?.path
      if (!activePath) throw createClientInvariantError('Identity frame has no selected file owner')
      observations.push({
        phase,
        path: activePath,
        input: retentionIdentityInput(app, activePath),
        sample: captureRetentionAcceptancePaint(app, activePath, tab.id),
        capturedPaint: controller.getEditor()?.captureSnapshot(),
      })
      handle = requestAnimationFrame(record)
    }
    record()
    let finalSample: ReturnType<typeof captureRetentionAcceptancePaint> | null = null
    let current: Awaited<ReturnType<typeof retentionIdentityReference>> | null = null
    let renameOperationId: string | null = null
    try {
      phase = 'identity-change-requested-response-held'
      if (axis === 'language') {
        path = filesystemPath(`repo/src/identity-language-${family}.js`)
        renameOperationId = await renameFixture(app, initialPath, path, context)
        const disk = await app.queryClient.query({
          queryKey: ['retention-identity-disk', path],
          queryFn: ({ signal }) => statPath(path, signal, clientForQueryClient(app.queryClient)),
        })
        expect(disk.path).toBe(path)
        await context.annotate(
          JSON.stringify({ path, disk, renameOperationId }),
          'identity-journaled-disk-rename',
        )
        await expect.poll(() => controller.getSnapshot()?.languageId).toBe('javascript')
        expect(retentionAcceptanceSubject(app, path).document.key).toBe(fileDocumentKey(path))
        expect(controller.getSnapshot()?.documentId).toBe(fileDocumentKey(path))
      }
      if (axis === 'theme') {
        previewEditorTheme('dark', 'github-dark')
        await expect.poll(() => app.read().theme.appliedThemeId).toBe('github-dark')
      }
      if (axis === 'provider') {
        previewEditorTheme('dark', 'tree-sitter-dark')
        await expect.poll(() => app.read().theme.appliedThemeId).toBe('tree-sitter-dark')
      }
      if (axis === 'configuration') {
        await userEvent.click(page.getByRole('button', { name: 'Fixture syntax highlighting' }))
        await expect
          .poll(() => readSettingsMirror()['editor.syntaxHighlighting.enabled'])
          .toBe(false)
        await expect.poll(() => controller.getSnapshot()?.syntaxStatus).toBe('plain')
      }
      const changed = retentionIdentityInput(app, path)
      phase = 'identity-changed-response-held'
      expect(changed.tags).not.toEqual(initialInput.tags)
      if (axis === 'language')
        expect(changed.configuredOwner.languageId).not.toBe(initialInput.configuredOwner.languageId)
      if (axis === 'provider')
        expect(changed.configuredBackend).not.toBe(initialInput.configuredBackend)
      controller.commands.setSelection(0)
      controller.commands.focus()
      const document = retentionAcceptanceSubject(app, path).document
      const before = document.buffer.materializeFullText()
      await commands.proofKeyPress({ key: 'x' })
      expect(document.buffer.materializeFullText()).toBe('x' + before)
      await frame()
      expect(gate.held()).toHaveLength(1)
      await context.annotate(
        JSON.stringify({ family, axis, changed, held: gate.held(), requests: gate.requests() }),
        'identity-held-native-packet',
      )
      phase = 'old-response-released'
      gate.release()
      if (axis !== 'configuration') {
        await expect.poll(() => controller.getSnapshot()?.syntaxStatus).toBe('ready')
        await expect.poll(() => controller.getSnapshot()?.initialHighlightStatus).toBe('painted')
      }
      await awaitEditorSyntaxWorkerIdleFences()
      await frame()
      recording = false
      cancelAnimationFrame(handle)
      current = await retentionIdentityReference(retentionIdentityInput(app, path))
      finalSample = captureRetentionAcceptancePaint(app, path, tab.id)
      expect(tokenPaintMismatch(finalSample.frame, current)).toBeNull()
      if (axis !== 'configuration') assertRetentionAcceptancePaint(finalSample, current, path)
      if (axis === 'language')
        expect(
          tokenPaintMismatch(finalSample.frame, {
            ...current,
            identity: { ...current.identity, document: initialInput.analysisDocumentId },
          }),
        ).not.toBeNull()
      if (axis === 'provider') {
        const entries = retentionIdentityInput(app, path).retention.entries
        expect(entries.some((entry) => entry.family === 'structural' && entry.leaseCount > 0)).toBe(
          true,
        )
        expect(
          entries.some((entry) => entry.family === 'highlighter' && entry.leaseCount > 0),
        ).toBe(false)
      }
      const archived = await referenceFrames(observations)
      await context.annotate(
        JSON.stringify({ family, axis, current, finalSample, archived, requests: gate.requests() }),
        'identity-complete-frame-references',
      )
      for (const observation of archived) assertFrame(observation)
      if (typeof commands.retentionAcceptanceScreenshot === 'function')
        await commands.retentionAcceptanceScreenshot(`identity-${axis}-${family}`)
    } finally {
      recording = false
      cancelAnimationFrame(handle)
      gate.release()
      const archived = await referenceFrames(observations)
      await context.annotate(
        JSON.stringify({
          family,
          axis,
          current,
          finalSample,
          archived,
          requests: gate.requests(),
          held: gate.held(),
        }),
        'identity-final-raw-receipt',
      )
      if (!readSettingsMirror()['editor.syntaxHighlighting.enabled']) {
        await userEvent.click(page.getByRole('button', { name: 'Fixture syntax highlighting' }))
        await expect
          .poll(() => readSettingsMirror()['editor.syntaxHighlighting.enabled'])
          .toBe(true)
      }
      if (renameOperationId !== null) {
        const restored = await reverseLatestFileOperation(
          fileRuntime(app),
          'undo',
          renameOperationId,
        )
        expect(restored).toBe(true)
        await context.annotate(
          JSON.stringify({ renameOperationId, restored }),
          'identity-journal-restore',
        )
      }
      if (cleanupLanguageFixture)
        await context.annotate(
          JSON.stringify({ initialPath, outcomes: await cleanupLanguageFixture() }),
          'identity-disposable-language-cleanup',
        )
    }
  },
)

function fileRuntime(app: Awaited<ReturnType<typeof mountRetentionAcceptanceApp>>) {
  const state = app.read()
  return {
    queryClient: app.queryClient,
    rootPath: app.rootPath,
    workspaceEdits: app.application.getSnapshot().editor.workspaceEditService,
    documents: fileOperationDocuments({
      documentStore: state.documents,
      queryClient: app.queryClient,
      renameLiveEditorDocument: state.commands.renameLiveEditorDocument,
      workspaceStore: state.workspace,
    }),
  }
}

async function renameFixture(
  app: Awaited<ReturnType<typeof mountRetentionAcceptanceApp>>,
  from: ReturnType<typeof filesystemPath>,
  path: ReturnType<typeof filesystemPath>,
  context: Pick<TestContext, 'annotate'>,
) {
  const renamed = await runFileOperation(fileRuntime(app), {
    label: 'Fixture language identity rename',
    legs: [{ from, kind: 'rename', to: path, type: 'file' }],
    patch: {
      kind: 'move',
      rootPath: app.rootPath,
      moves: [{ fromTreePath: from.slice('repo/'.length), toTreePath: path.slice('repo/'.length) }],
    },
  })
  await context.annotate(
    JSON.stringify({ from, path, renamed }),
    'identity-journal-operation-result',
  )
  expect(renamed.ok).toBe(true)
  if (!renamed.ok) return null
  return renamed.result.operationId
}

async function createLanguageFixture(
  app: Awaited<ReturnType<typeof mountRetentionAcceptanceApp>>,
  path: ReturnType<typeof filesystemPath>,
  context: Pick<TestContext, 'onTestFinished' | 'annotate'>,
) {
  const client = clientForQueryClient(app.queryClient)
  await runMutation(
    app.queryClient,
    {
      mutationFn: () =>
        createFileContent(
          path,
          "export const identityAcceptance = 'native worker fixture'\n",
          client,
        ),
      onSuccess: async () => {
        await ensureFileSnapshotQuery(app.queryClient, path)
      },
    },
    undefined,
  )
  let cleanupReceipt: Awaited<ReturnType<typeof removeLanguageFixture>> | null = null
  const cleanup = async () => {
    cleanupReceipt ??= await removeLanguageFixture(path, client)
    return cleanupReceipt
  }
  context.onTestFinished(async () => {
    await cleanup()
  })
  await expect
    .poll(() => app.queryClient.getQueryData(fileSystemKeys.tree(app.rootPath)))
    .toBeDefined()
  const destination = filesystemPath(path.slice(0, -3) + '.js')
  const knownGood = await renameFixture(app, path, destination, context)
  expect(knownGood).not.toBeNull()
  if (knownGood === null) return cleanup
  expect(await reverseLatestFileOperation(fileRuntime(app), 'undo', knownGood)).toBe(true)
  await context.annotate(
    JSON.stringify({ path, destination, knownGood, restored: true }),
    'identity-journal-known-good',
  )
  return cleanup
}

async function removeLanguageFixture(
  path: ReturnType<typeof filesystemPath>,
  client: ReturnType<typeof clientForQueryClient>,
) {
  const destination = filesystemPath(path.slice(0, -3) + '.js')
  const outcomes = await Promise.allSettled([
    deletePath(path, false, client),
    deletePath(destination, false, client),
  ])
  expect(outcomes.some((outcome) => outcome.status === 'fulfilled')).toBe(true)
  return outcomes
}

test.for(['shiki', 'tree-sitter'] as const)(
  '$0 cold actual app attachment remains truthful before native readiness',
  { timeout: 45_000 },
  async (family, context) => {
    installTrace(context)
    const gate = holdRetentionIdentityWorkerReply()
    const app = await mountRetentionAcceptanceApp([], 'surfaces', <RetentionIdentityEntry />)
    await ensureFileSnapshotQuery(app.queryClient, sourcePath)
    expect(
      app.read().documents.getState().getLiveEditorDocument(fileDocumentKey(sourcePath)),
    ).toBeFalsy()
    expect(app.read().ui.getState().controllersByTabId.size).toBe(0)
    gate.arm(family === 'shiki' ? 'open' : 'parse', family)
    expect(await app.read().commands.openFileSurface(sourcePath)).toMatchObject({
      status: 'applied',
    })
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
    expect(tab).not.toBeNull()
    if (!tab) return
    await expect.poll(() => app.read().ui.getState().controllersByTabId.has(tab.id)).toBe(true)
    const controller = app.read().ui.getState().controllersByTabId.get(tab.id)
    expect(controller).toBeDefined()
    if (!controller) return
    const observations: IdentityObservation[] = []
    let phase = 'cold-native-response-held'
    let recording = true
    let handle = 0
    const record = () => {
      if (!recording) return
      observations.push({
        phase,
        path: sourcePath,
        input: retentionIdentityInput(app, sourcePath),
        sample: captureRetentionAcceptancePaint(app, sourcePath, tab.id),
        capturedPaint: controller.getEditor()?.captureSnapshot(),
      })
      handle = requestAnimationFrame(record)
    }
    record()
    let current: Awaited<ReturnType<typeof retentionIdentityReference>> | null = null
    let finalSample: ReturnType<typeof captureRetentionAcceptancePaint> | null = null
    try {
      await expect.poll(() => gate.held().length).toBe(1)
      const held = gate.held()
      expect(held[0]?.response).toMatchObject({ id: held[0]?.request.id })
      const before = retentionAcceptanceSubject(
        app,
        sourcePath,
      ).document.buffer.materializeFullText()
      controller.commands.setSelection(0)
      controller.commands.focus()
      await commands.proofKeyPress({ key: 'x' })
      expect(
        retentionAcceptanceSubject(app, sourcePath).document.buffer.materializeFullText(),
      ).toBe('x' + before)
      await frame()
      expect(gate.held()).toHaveLength(1)
      expect(
        controller.getSnapshot()?.syntaxStatus === 'ready' &&
          controller.getSnapshot()?.initialHighlightStatus === 'painted',
      ).toBe(false)
      await context.annotate(
        JSON.stringify({ family, held, requests: gate.requests() }),
        'identity-cold-held-native-packet',
      )
      phase = 'cold-native-response-released'
      gate.release()
      await awaitRetentionAcceptanceReady(app, sourcePath)
      await awaitEditorSyntaxWorkerIdleFences()
      await frame()
      recording = false
      cancelAnimationFrame(handle)
      current = await retentionIdentityReference(retentionIdentityInput(app, sourcePath))
      finalSample = captureRetentionAcceptancePaint(app, sourcePath, tab.id)
      assertRetentionAcceptancePaint(finalSample, current, sourcePath)
      const archived = await referenceFrames(observations)
      await context.annotate(
        JSON.stringify({ family, current, finalSample, archived, requests: gate.requests() }),
        'identity-cold-complete-frame-references',
      )
      for (const observation of archived) assertFrame(observation)
      if (typeof commands.retentionAcceptanceScreenshot === 'function')
        await commands.retentionAcceptanceScreenshot(`identity-cold-${family}`)
    } finally {
      recording = false
      cancelAnimationFrame(handle)
      gate.release()
      const archived = await referenceFrames(observations)
      await context.annotate(
        JSON.stringify({ family, current, finalSample, archived, requests: gate.requests() }),
        'identity-cold-final-raw-receipt',
      )
    }
  },
)

type IdentityObservation = {
  readonly phase: string
  readonly path: ReturnType<typeof filesystemPath>
  readonly input: ReturnType<typeof retentionIdentityInput>
  readonly sample: ReturnType<typeof captureRetentionAcceptancePaint>
  readonly capturedPaint: unknown
}

async function referenceFrames(observations: readonly IdentityObservation[]) {
  const references = new Map<string, Awaited<ReturnType<typeof retentionIdentityReference>>>()
  const archived = []
  for (const observation of observations) {
    const key = JSON.stringify({
      identity: observation.input.identity,
      source: observation.input.source,
      owner: observation.input.configuredOwner,
      enabled: observation.input.enabled,
    })
    const reference = references.get(key) ?? (await retentionIdentityReference(observation.input))
    references.set(key, reference)
    archived.push({
      ...observation,
      reference,
      mismatch: tokenPaintMismatch(observation.sample.frame, reference),
    })
  }
  return archived
}

function assertFrame(observation: Awaited<ReturnType<typeof referenceFrames>>[number]) {
  const { sample, reference } = observation
  expect(sample.installed.source).toBe(reference.source)
  if (
    sample.installed.syntaxStatus === 'ready' &&
    sample.installed.initialHighlightStatus === 'painted'
  ) {
    expect(sample.installed.syncPoint.revision).toBe(observation.input.identity.revision)
    assertRetentionAcceptancePaint(sample, reference, observation.path)
  }
  if (!observation.input.enabled) expect(observation.mismatch).toBeNull()
}

function frame() {
  return new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
}

function installTrace(context: { onTestFinished(callback: () => void): void }) {
  vi.stubEnv('OBSERVABILITY_ENABLED', 'true')
  const original = location.href
  const url = new URL(original)
  url.searchParams.set('editorPerfTrace', '1')
  history.replaceState(null, '', url)
  installEditorPerformanceTraceFromUrl()
  context.onTestFinished(() => {
    history.replaceState(null, '', original)
    installEditorPerformanceTraceFromUrl()
    vi.unstubAllEnvs()
  })
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofKeyPress(input: { readonly key: string }): Promise<void>
    retentionAcceptanceScreenshot(label: string): Promise<string>
  }
}
