import { expect, test, inject } from 'vitest'
import { page, commands } from 'vitest/browser'
import { activeEnvironmentId, confirmedEnvironmentId } from '@/lib/environments/state/domain'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { activeEditorTab, allEditorGroups } from '@/lib/documents/utils/groups'
import { mountRetentionLayoutApp } from '../../../../test/factories/retention-acceptance-layout-app'
import {
  captureRetentionLayoutView,
  recordRetentionLayoutFrames,
  awaitRetentionLayoutCurrent,
} from '../../../../test/factories/retention-acceptance-layout-observation'
import { addLayoutReservation } from '../../../../test/factories/retention-acceptance-layout-reservation'
import {
  retentionAcceptanceProjection,
  retentionAcceptanceProjectionMismatch,
  retentionAcceptanceFoldMismatch,
} from '../../../../test/factories/retention-acceptance-projection'

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionLayoutArchive(payload: string, label: string): Promise<string>
    proofContextClick(input: { readonly selector: string }): Promise<void>
    proofKeyPress(input: { readonly key: string }): Promise<void>
  }
}

test.for(['original', 'copy'] as const)(
  '$0 departure preserves two live differing-layout models and a retained environment',
  { timeout: 30_000 },
  async (departing, context) => {
    const app = await mountRetentionLayoutApp()
    const path = filesystemPath('repo/src/retention-layout.ts')
    const primaryEnvironment = activeEnvironmentId()
    const knownPeer = app.application.connections.store
      .getState()
      .machines.find(
        (machine) =>
          machine.config.kind === 'origin' && machine.config.url === inject('layoutPeerOrigin'),
      )
    if (knownPeer) {
      expect(await app.application.connections.connectMachine(knownPeer.name)).toBe('connected')
    } else {
      await page.getByRole('button', { name: 'Switch project', exact: true }).click()
      await page.getByRole('menuitem', { name: 'Connect machine…', exact: true }).click()
      if (
        [...document.querySelectorAll('button')].some(
          (button) => button.textContent?.trim() === 'Add machine',
        )
      )
        await page.getByRole('button', { name: 'Add machine', exact: true }).click()
      await page.getByRole('button', { name: /^Remote URL/ }).click()
      await page
        .getByRole('textbox', { name: 'Server URL', exact: true })
        .fill(inject('layoutPeerOrigin'))
      await page.getByRole('button', { name: 'Connect', exact: true }).click()
    }
    await expect
      .poll(() =>
        app.application.connections.store
          .getState()
          .machines.some(
            (machine) => machine.origin === inject('layoutPeerOrigin') && machine.phase === 'live',
          ),
      )
      .toBe(true)
    const peerEnvironment = confirmedEnvironmentId(inject('layoutPeerOrigin'))
    expect(peerEnvironment).not.toBe(primaryEnvironment)
    expect(await app.navigation.openEnvironment(peerEnvironment)).toMatchObject({
      status: 'applied',
    })
    expect(
      await app.application.openEnvironmentWorkspaceRoot(peerEnvironment, filesystemPath('repo')),
    ).toMatch(/opened|already-open/)
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
    const reservation = addLayoutReservation(reservedEditor, 40)
    const copiedEditor = app.read().ui.getState().controllersByTabId.get(copy.id)?.getEditor()
    expect(copiedEditor).toBeDefined()
    if (!copiedEditor) return
    const copyReservation = addLayoutReservation(copiedEditor, 0)
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    const sample = captureRetentionLayoutView(app, path, tab.id)
    const other = captureRetentionLayoutView(app, path, copy.id)
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
      ? document.querySelector(`[data-editor-group-id="${departingGroup.id}"] .editor-virtualized`)
      : null
    const editing = app.read().ui.getState().controllersByTabId.get(closeTab.id)
    expect(editing).toBeDefined()
    if (!editing) return
    const recording = recordRetentionLayoutFrames(app, path, [tab.id, copy.id])
    context.onTestFinished(recording.stop)
    editing.commands.edit({
      from: initialSource.length,
      to: initialSource.length,
      text: `// dirty ${departing}\n`,
    })
    await awaitRetentionLayoutCurrent(app, path)
    const beforeClose = [tab.id, copy.id].map((id) => captureRetentionLayoutView(app, path, id))
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
    expect(survivor.kind).toBe('current')
    if (survivor.kind === 'current') expect(survivor.mismatch).toBeNull()
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    recording.stop()
    for (const frame of recording.frames)
      for (const view of frame.views) {
        if (view.kind !== 'current') continue
        expect(view.headerPath).toBe(path)
        expect(view.mismatch, JSON.stringify({ at: frame.at, view })).toBeNull()
        expect(view.ownership.bufferMatchesCanonical).toBe(true)
      }
    const retained = app.application.getEnvironment(peerEnvironment)
    expect(retained?.editor.documentStore.getState().getLiveEditorDocument(peerKey)?.buffer).toBe(
      peerDocument.buffer,
    )
    expect(retained?.editor.documentStore.getState().getLiveEditorDocument(peerKey)?.analysis).toBe(
      peerDocument.analysis,
    )
    expect(peerDocument.buffer.materializeFullText()).toBe(
      'export const retainedEnvironmentValue = 37\n',
    )
    expect(await app.navigation.openEnvironment(peerEnvironment)).toMatchObject({
      status: 'applied',
    })
    await awaitRetentionLayoutCurrent(app, path)
    const peerCurrent = captureRetentionLayoutView(app, path, peerTab.id)
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
  },
)
