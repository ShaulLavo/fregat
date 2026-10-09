import { expect, test, inject, type TestContext } from 'vitest'
import { page, commands } from 'vitest/browser'
import { activeEnvironmentId, confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { activeEditorTab, allEditorGroups } from '@/lib/documents/utils/groups'
import { mountRetentionLayoutApp } from '../../../../test/factories/retention-acceptance-layout-app'
import {
  captureRetentionLayoutView,
  recordRetentionLayoutFrames,
  awaitRetentionLayoutCurrent,
  assertRecordedRetentionLayoutFrames,
} from '../../../../test/factories/retention-acceptance-layout-observation'
import { addLayoutReservation } from '../../../../test/factories/retention-acceptance-layout-reservation'
import {
  retentionAcceptanceProjection,
  retentionAcceptanceProjectionMismatch,
  retentionAcceptanceFoldMismatch,
} from '../../../../test/factories/retention-acceptance-projection'

declare module 'vitest' {
  interface ProvidedContext {
    layoutPeerOrigin: string
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionLayoutArchive(
      payload: string,
      label: string,
      annotationFailure?: {
        readonly directory: string
        readonly failures: readonly { stage: string; error: string }[]
      },
    ): Promise<string>
    proofContextClick: (input: { readonly selector: string }) => Promise<void>
    proofKeyPress: (input: { readonly key: string }) => Promise<void>
  }
}

type LayoutEvidenceFailure = { stage: string; error: string }

async function archiveRetentionLayoutEvidence(
  context: Pick<TestContext, 'annotate'>,
  payload: { readonly evidenceFailures: LayoutEvidenceFailure[] },
  label: string,
  annotationLabel: string,
) {
  const directory = await commands.retentionLayoutArchive(JSON.stringify(payload), label)
  try {
    await context.annotate(directory, annotationLabel)
  } catch (error) {
    payload.evidenceFailures.push({
      stage: 'annotation',
      error: error instanceof Error ? error.message : String(error),
    })
    try {
      await commands.retentionLayoutArchive(JSON.stringify(payload), label, {
        directory,
        failures: payload.evidenceFailures,
      })
    } catch (archiveError) {
      payload.evidenceFailures.push({
        stage: 'annotation-failure-archive',
        error: archiveError instanceof Error ? archiveError.message : String(archiveError),
      })
    }
    throw error
  }
}

async function finalizeRetentionLayoutEvidence(
  primaryFailed: boolean,
  failures: LayoutEvidenceFailure[],
  actions: readonly { stage: string; run: () => unknown | Promise<unknown> }[],
) {
  let firstFailure: { error: unknown } | null = null
  for (const action of actions) {
    try {
      await action.run()
    } catch (error) {
      firstFailure ??= { error }
      failures.push({
        stage: action.stage,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }
  if (!primaryFailed && firstFailure) throw firstFailure.error
}

test.for(['original', 'copy'] as const)(
  '$0 departure preserves two live differing-layout models and a retained environment',
  { timeout: 30_000 },
  async (departing, context) => {
    let recording: ReturnType<typeof recordRetentionLayoutFrames> | null = null
    const reservationCaptures: ReturnType<typeof addLayoutReservation>['capture'][] = []
    let primaryFailed = false
    const evidenceFailures: LayoutEvidenceFailure[] = []
    const failureArchive: {
      departing: string
      stage: string
      frames: unknown
      points: Record<string, unknown>
      evidenceFailures: LayoutEvidenceFailure[]
    } = { departing, evidenceFailures, stage: 'initial', frames: [], points: {} }
    try {
      const app = await mountRetentionLayoutApp()
      const path = filesystemPath('repo/src/retention-layout.ts')
      const primaryEnvironment = activeEnvironmentId()
      const peerName = 'retention-layout-peer'
      const existing = app.application.connections.store.getState().machines
      const configuration = Object.fromEntries(
        existing.map((machine): [string, typeof machine.config] => [machine.name, machine.config]),
      )
      app.application.connections.configureMachines({
        ...configuration,
        [peerName]: { kind: 'origin', url: inject('layoutPeerOrigin') },
      })
      expect(await app.application.connections.connectMachine(peerName)).toBe('connected')
      await expect
        .poll(() =>
          app.application.connections.store
            .getState()
            .machines.some(
              (machine) =>
                machine.origin === inject('layoutPeerOrigin') && machine.phase === 'live',
            ),
        )
        .toBe(true)
      const peerEnvironment = confirmedEnvironmentId(inject('layoutPeerOrigin'))
      expect(peerEnvironment).not.toBe(primaryEnvironment)
      expect(await app.navigation.openEnvironment(peerEnvironment)).toMatchObject({
        status: 'applied',
      })
      expect(
        await app.navigation.openWorkspace({
          environmentId: peerEnvironment,
          path: filesystemPath('repo'),
        }),
      ).toMatchObject({ status: 'applied' })
      expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
      await awaitRetentionLayoutCurrent(app, path)
      const peerTab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
      expect(peerTab).not.toBeNull()
      if (!peerTab) return
      const peerKey = app.read().documents.getState().viewsByTabId[peerTab.id]?.documentKey
      expect(peerKey).toBeDefined()
      if (!peerKey) return
      const peerDocument = app.read().documents.getState().getLiveEditorDocument(peerKey)
      expect(peerDocument).toBeDefined()
      expect(await app.navigation.openEnvironment(primaryEnvironment)).toMatchObject({
        status: 'applied',
      })

      expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
      await awaitRetentionLayoutCurrent(app, path)
      const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
      expect(tab).not.toBeNull()
      if (!tab) return
      await commands.proofContextClick({ selector: `[data-editor-tab-id="${tab.id}"]` })
      await page.getByRole('menuitem', { name: 'Split Right', exact: true }).click()
      await expect.poll(() => app.read().ui.getState().controllersByTabId.size).toBe(2)
      const groups = app.read().workspace.getState().workbenchPanels.editorGroups
      const tabs = allEditorGroups(groups).flatMap((group) => group.tabs)
      const copy = tabs.find((entry) => entry.id !== tab.id)
      expect(copy).toBeDefined()
      expect(groups.root.kind).toBe('split')
      if (!copy || groups.root.kind !== 'split') return
      const handleId = `${groups.root.id}-${groups.root.children[1].node.id}`
      const handle = document.getElementById(handleId)
      expect(handle).not.toBeNull()
      if (!handle) return
      await page.elementLocator(handle).click()
      for (let step = 0; step < 15; step += 1) await commands.proofKeyPress({ key: 'ArrowRight' })
      const first = app.read().ui.getState().controllersByTabId.get(tab.id)?.getEditor()
      const second = app.read().ui.getState().controllersByTabId.get(copy.id)?.getEditor()
      expect(first).toBeDefined()
      expect(second).toBeDefined()
      if (!first || !second) return
      first.setWordWrap(true)
      second.setWordWrap(true)
      await page
        .getByRole('button', { name: 'Collapse foldable region', exact: true })
        .first()
        .click()
      await expect
        .poll(() =>
          app
            .read()
            .ui.getState()
            .controllersByTabId.get(tab.id)
            ?.getSnapshot()
            ?.foldMarkers.some((marker) => marker.collapsed),
        )
        .toBe(true)
      await awaitRetentionLayoutCurrent(app, path)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      const reservedEditor = app.read().ui.getState().controllersByTabId.get(tab.id)?.getEditor()
      expect(reservedEditor).toBeDefined()
      if (!reservedEditor) return
      const reservation = addLayoutReservation(reservedEditor, 40, app.identifyReference)
      reservationCaptures.push(reservation.capture)
      const copiedEditor = app.read().ui.getState().controllersByTabId.get(copy.id)?.getEditor()
      expect(copiedEditor).toBeDefined()
      if (!copiedEditor) return
      const copyReservation = addLayoutReservation(copiedEditor, 0, app.identifyReference)
      reservationCaptures.push(copyReservation.capture)
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      const sample = captureRetentionLayoutView(app, path, tab.id)
      const other = captureRetentionLayoutView(app, path, copy.id)
      failureArchive.stage = 'two-live-geometry'
      failureArchive.points.geometry = {
        sample,
        other,
        originalReservation: reservation.capture(),
        copiedReservation: copyReservation.capture(),
      }
      await context.annotate(
        await commands.retentionLayoutArchive(
          JSON.stringify({
            sample,
            other,
            reservation: reservation.capture(),
            dom: document.body.innerHTML,
          }),
          'layout-known-good',
        ),
        'layout-known-good',
      )
      expect(sample.kind).toBe('current')
      if (sample.kind !== 'current') return
      expect(sample.headerPath).toBe(path)
      expect(sample.mismatch).toBeNull()
      expect(other.kind).toBe('current')
      if (other.kind !== 'current') return
      expect(other.mismatch).toBeNull()
      expect(sample.geometry.width).not.toBe(other.geometry.width)
      expect(reservation.capture().actual?.left).toBe(40)
      expect(sample.geometry.folds.some((fold) => fold.collapsed)).toBe(true)
      expect(other.geometry.folds.some((fold) => fold.collapsed)).toBe(false)
      expect(other.geometry.wrappedRows).toBeGreaterThan(0)
      expect(sample.ownership.documentId).toBe(other.ownership.documentId)
      expect(app.read().documents.getState().viewsByTabId[tab.id]?.view).not.toBe(
        app.read().documents.getState().viewsByTabId[copy.id]?.view,
      )
      expect(
        retentionAcceptanceProjectionMismatch(
          { ...sample.frame, rows: sample.frame.rows.slice(1) },
          sample.projection,
        ),
      ).not.toBeNull()
      expect(
        retentionAcceptanceProjectionMismatch({ ...sample.frame, runs: [] }, sample.projection),
      ).not.toBeNull()
      expect(
        retentionAcceptanceProjectionMismatch(
          {
            ...sample.frame,
            identity: {
              ...sample.frame.identity,
              revision: (sample.frame.identity.revision ?? 0) + 1,
            },
          },
          sample.projection,
        ),
      ).not.toBeNull()
      const token = sample.frame.runs[0]
      expect(token).toBeDefined()
      if (token)
        expect(
          retentionAcceptanceProjectionMismatch(
            {
              ...sample.frame,
              runs: [
                { ...token, style: { ...token.style, color: 'rgb(0, 0, 0)' } },
                ...sample.frame.runs.slice(1),
              ],
            },
            sample.projection,
          ),
        ).not.toBeNull()
      const truncated = retentionAcceptanceProjection({
        metadata: { ...sample.metadata, rows: sample.metadata.rows.slice(1) },
        binding: sample.binding,
        reference: sample.reference,
      })
      if (truncated.kind === 'mapped')
        expect(retentionAcceptanceProjectionMismatch(sample.frame, truncated)).not.toBeNull()
      const missingBlank = retentionAcceptanceProjection({
        metadata: {
          ...sample.metadata,
          rows: sample.metadata.rows.filter((row) =>
            row.chunks.some((chunk) => chunk.sourceEndOffset > chunk.sourceStartOffset),
          ),
        },
        binding: sample.binding,
        reference: sample.reference,
      })
      if (missingBlank.kind === 'mapped')
        expect(retentionAcceptanceProjectionMismatch(sample.frame, missingBlank)).not.toBeNull()
      const wrongFold = {
        ...sample.projection,
        metadata: {
          ...sample.metadata,
          rows: sample.metadata.rows.map((row) => ({
            ...row,
            foldMarker: row.foldMarker ? { ...row.foldMarker, collapsed: false } : null,
          })),
        },
      }
      const group = allEditorGroups(groups).find((entry) => entry.selectedTabId === tab.id)
      expect(group).toBeDefined()
      if (group)
        expect(
          retentionAcceptanceFoldMismatch(
            wrongFold,
            `[data-editor-group-id="${group.id}"] .editor-virtualized-viewport`,
          ),
        ).not.toBeNull()

      const canonicalKey = app.read().documents.getState().viewsByTabId[tab.id]?.documentKey
      expect(canonicalKey).toBeDefined()
      if (!canonicalKey) return
      const canonical = app.read().documents.getState().getLiveEditorDocument(canonicalKey)
      expect(canonical).toBeDefined()
      if (!canonical || !peerDocument) return
      expect(canonical.buffer).not.toBe(peerDocument.buffer)
      expect(canonical.buffer.isDirty()).toBe(false)
      const initialSource = canonical.buffer.materializeFullText()
      const closeTab = departing === 'original' ? tab : copy
      const survivorTab = departing === 'original' ? copy : tab
      const departingReservation = departing === 'original' ? reservation : copyReservation
      const departingGroup = allEditorGroups(
        app.read().workspace.getState().workbenchPanels.editorGroups,
      ).find((group) => group.selectedTabId === closeTab.id)
      const departingNode = departingGroup
        ? document.querySelector(
            `[data-editor-group-id="${departingGroup.id}"] .editor-virtualized`,
          )
        : null
      const editing = app.read().ui.getState().controllersByTabId.get(closeTab.id)
      expect(editing).toBeDefined()
      if (!editing) return
      recording = recordRetentionLayoutFrames(app, path, [tab.id, copy.id])
      editing.commands.edit({
        from: initialSource.length,
        to: initialSource.length,
        text: `// dirty ${departing}\n`,
      })
      await awaitRetentionLayoutCurrent(app, path)
      const beforeClose = [tab.id, copy.id].map((id) => captureRetentionLayoutView(app, path, id))
      failureArchive.stage = 'before-primary-close'
      failureArchive.points.beforeClose = beforeClose
      expect(
        beforeClose.every((sample) => sample.kind === 'current' && sample.mismatch === null),
      ).toBe(true)
      const survivorView = app.read().documents.getState().viewsByTabId[survivorTab.id]?.view
      await commands.proofContextClick({ selector: `[data-editor-tab-id="${closeTab.id}"]` })
      await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
      await expect
        .poll(() => app.read().documents.getState().viewsByTabId[closeTab.id])
        .toBeUndefined()
      await expect.poll(() => departingReservation.capture().disposed).toBe(true)
      expect(departingNode?.isConnected).toBe(false)
      expect(app.read().ui.getState().controllersByTabId.has(closeTab.id)).toBe(false)
      expect(app.read().documents.getState().viewsByTabId[survivorTab.id]?.view).toBe(survivorView)
      expect(app.read().documents.getState().getLiveEditorDocument(canonicalKey)?.buffer).toBe(
        canonical.buffer,
      )
      expect(app.read().documents.getState().getLiveEditorDocument(canonicalKey)?.analysis).toBe(
        canonical.analysis,
      )
      expect(canonical.buffer.isDirty()).toBe(true)
      const controller = app.read().ui.getState().controllersByTabId.get(survivorTab.id)
      expect(controller).toBeDefined()
      if (!controller) return
      const afterCloseSource = canonical.buffer.materializeFullText()
      controller.commands.edit({
        from: afterCloseSource.length,
        to: afterCloseSource.length,
        text: '// survivor still editable\n',
      })
      expect(controller.commands.dispatchCommand('undo')).toBe(true)
      expect(canonical.buffer.materializeFullText()).toBe(afterCloseSource)
      expect(controller.commands.dispatchCommand('undo')).toBe(true)
      expect(canonical.buffer.materializeFullText()).toBe(initialSource)
      expect(canonical.buffer.isDirty()).toBe(false)
      expect(controller.commands.dispatchCommand('redo')).toBe(true)
      expect(controller.commands.dispatchCommand('redo')).toBe(true)
      expect(canonical.buffer.isDirty()).toBe(true)
      await awaitRetentionLayoutCurrent(app, path)
      const survivor = captureRetentionLayoutView(app, path, survivorTab.id)
      failureArchive.stage = 'after-primary-close-undo-redo-before-peer'
      failureArchive.points.survivor = {
        sample: survivor,
        originalReservation: reservation.capture(),
        copiedReservation: copyReservation.capture(),
      }
      expect(survivor.kind).toBe('current')
      if (survivor.kind === 'current') expect(survivor.mismatch).toBeNull()
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      )
      recording.stop()
      assertRecordedRetentionLayoutFrames(recording.frames, path)
      const retained = app.application.getEnvironment(peerEnvironment)
      expect(retained?.editor.documentStore.getState().getLiveEditorDocument(peerKey)?.buffer).toBe(
        peerDocument.buffer,
      )
      expect(
        retained?.editor.documentStore.getState().getLiveEditorDocument(peerKey)?.analysis,
      ).toBe(peerDocument.analysis)
      expect(peerDocument.buffer.materializeFullText()).toBe(
        'export const retainedEnvironmentValue = 37\n',
      )
      expect(await app.navigation.openEnvironment(peerEnvironment)).toMatchObject({
        status: 'applied',
      })
      await awaitRetentionLayoutCurrent(app, path)
      const peerCurrent = captureRetentionLayoutView(app, path, peerTab.id)
      failureArchive.stage = 'peer-reactivated'
      failureArchive.points.peerCurrent = peerCurrent
      expect(peerCurrent.kind).toBe('current')
      if (peerCurrent.kind === 'current') expect(peerCurrent.mismatch).toBeNull()
      await context.annotate(
        await commands.retentionLayoutArchive(
          JSON.stringify({
            departing,
            frames: recording.frames,
            beforeClose,
            survivor,
            peerCurrent,
            reservationAfterClose: reservation.capture(),
            copyReservationAfterClose: copyReservation.capture(),
            closedResources: {
              contributionDisposed: departingReservation.capture().disposed,
              domDetached: !departingNode?.isConnected,
              controllerAbsent: !app.read().ui.getState().controllersByTabId.has(closeTab.id),
            },
            primaryEnvironment,
            peerEnvironment,
            peerBufferSurvived:
              retained?.editor.documentStore.getState().getLiveEditorDocument(peerKey)?.buffer ===
              peerDocument.buffer,
          }),
          `layout-survivor-${departing}`,
        ),
        'layout-survivor',
      )
    } catch (error) {
      primaryFailed = true
      throw error
    } finally {
      const finalReservations: unknown[] = []
      failureArchive.points.finalReservations = finalReservations
      await finalizeRetentionLayoutEvidence(primaryFailed, evidenceFailures, [
        { stage: 'stop-recorder', run: () => recording?.stop() },
        {
          stage: 'recorded-frames',
          run: () => {
            failureArchive.frames = recording?.frames ?? []
          },
        },
        ...reservationCaptures.map((capture, index) => ({
          stage: 'final-reservation-' + index,
          run: () => {
            finalReservations[index] = capture()
          },
        })),
        {
          stage: 'archive-and-annotate',
          run: async () => {
            await archiveRetentionLayoutEvidence(
              context,
              failureArchive,
              `layout-interval-${departing}`,
              'layout-interval-always',
            )
          },
        },
      ])
    }
  },
)

test(
  'user word-wrap command survives closing the other pane',
  { timeout: 30_000 },
  async (context) => {
    const app = await mountRetentionLayoutApp()
    const path = filesystemPath('repo/src/retention-layout.ts')
    const identity = app.identifyReference
    let captureFinal: (() => unknown) | null = null
    let primaryFailed = false
    const evidenceFailures: LayoutEvidenceFailure[] = []
    const payload: {
      evidenceFailures: LayoutEvidenceFailure[]
      before: unknown
      after: unknown
      final: unknown
      frames: unknown
      stage: string
    } = {
      evidenceFailures,
      before: null,
      after: null,
      final: null,
      frames: [],
      stage: 'open',
    }
    let recording: ReturnType<typeof recordRetentionLayoutFrames> | null = null
    try {
      expect(await app.read().commands.openFileSurface(path)).toMatchObject({ status: 'applied' })
      await awaitRetentionLayoutCurrent(app, path)
      const original = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
      expect(original).not.toBeNull()
      if (!original) return
      await commands.proofContextClick({ selector: `[data-editor-tab-id="${original.id}"]` })
      await page.getByRole('menuitem', { name: 'Split Right', exact: true }).click()
      await expect.poll(() => app.read().ui.getState().controllersByTabId.size).toBe(2)
      const groups = allEditorGroups(app.read().workspace.getState().workbenchPanels.editorGroups)
      const other = groups.flatMap((group) => group.tabs).find((tab) => tab.id !== original.id)
      const group = groups.find((group) => group.selectedTabId === original.id)
      expect(other).toBeDefined()
      expect(group).toBeDefined()
      if (!other || !group) return
      const viewport = document.querySelector<HTMLElement>(
        `[data-editor-group-id="${group.id}"] .editor-virtualized-viewport`,
      )
      expect(viewport).not.toBeNull()
      if (!viewport) return
      await page.elementLocator(viewport).click()
      await commands.proofKeyPress({ key: 'Control+Shift+P' })
      const input = document.querySelector<HTMLInputElement>('[data-slot="command-input"]')
      expect(input).not.toBeNull()
      if (!input) return
      await page.elementLocator(input).fill('>Toggle word wrap')
      await page
        .getByRole('option', { name: /Toggle word wrap/ })
        .first()
        .click()
      const controller = app.read().ui.getState().controllersByTabId.get(original.id)
      const native = controller?.getEditor()
      const model = app.read().documents.getState().viewsByTabId[original.id]?.view
      expect(native?.isWordWrapEnabled()).toBe(true)
      if (!native) return
      const reservation = addLayoutReservation(native, 40, app.identifyReference)
      const capture = () => {
        const current = app.read().ui.getState().controllersByTabId.get(original.id)
        return {
          at: performance.now(),
          controllerIdentity: identity(current),
          nativeIdentity: identity(current?.getEditor()),
          logicalViewIdentity: identity(
            app.read().documents.getState().viewsByTabId[original.id]?.view,
          ),
          wrap: current?.getEditor()?.isWordWrapEnabled() ?? null,
          reservation: reservation.capture(),
          sample: captureRetentionLayoutView(app, path, original.id),
        }
      }
      await awaitRetentionLayoutCurrent(app, path)
      captureFinal = capture
      payload.before = capture()
      payload.stage = 'closing-other-pane'
      recording = recordRetentionLayoutFrames(app, path, [original.id, other.id])
      await commands.proofContextClick({ selector: `[data-editor-tab-id="${other.id}"]` })
      await page.getByRole('menuitem', { name: 'Close', exact: true }).click()
      await expect.poll(() => app.read().ui.getState().controllersByTabId.size).toBe(1)
      await awaitRetentionLayoutCurrent(app, path)
      payload.after = capture()
      payload.stage = 'after-primary-close-before-peer'
      expect(app.read().documents.getState().viewsByTabId[original.id]?.view).toBe(model)
      expect(
        app
          .read()
          .ui.getState()
          .controllersByTabId.get(original.id)
          ?.getEditor()
          ?.isWordWrapEnabled(),
      ).toBe(true)
    } catch (error) {
      primaryFailed = true
      throw error
    } finally {
      await finalizeRetentionLayoutEvidence(primaryFailed, evidenceFailures, [
        { stage: 'stop-recorder', run: () => recording?.stop() },
        {
          stage: 'recorded-frames',
          run: () => {
            payload.frames = recording?.frames ?? []
          },
        },
        {
          stage: 'final-capture',
          run: () => {
            payload.final = captureFinal?.() ?? null
          },
        },
        {
          stage: 'archive-and-annotate',
          run: async () => {
            await archiveRetentionLayoutEvidence(
              context,
              payload,
              'user-wrap-other-close',
              'user-wrap-other-close',
            )
          },
        },
      ])
    }
  },
)
