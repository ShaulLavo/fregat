import { expect, test } from 'vitest'
import { page, commands } from 'vitest/browser'
import { ForesightManager } from 'js.foresight'
import { activeEditorTab } from '@/lib/documents/utils/groups'
import { filesystemPath } from '@/lib/documents/utils/identity'
import { ensureFileSnapshotQuery, fileSnapshotQueryOptions } from '@/lib/file-snapshot-query-cache'
import { mountRetentionAcceptanceApp } from '../../../../test/factories/retention-acceptance-app'
import { installDelayedFileReadClient } from '../../../../test/factories/delayed-file-read-client'
import {
  assertRetentionAcceptancePaint,
  awaitRetentionAcceptanceReady,
  captureRetentionAcceptancePaint,
  retentionAcceptanceReference,
  retentionAcceptanceSubject,
} from '../../../../test/factories/retention-acceptance-paint'

const path = filesystemPath('repo/src/editor-tab-a.ts')

test(
  'actual predicted caller departure preserves a focused survivor through promotion and caller unmount',
  { timeout: 30_000 },
  async (context) => {
    const app = await mountRetentionAcceptanceApp([
      { slot: 'first', path },
      { slot: 'survivor', path },
    ])
    performance.clearResourceTimings()
    const transport = installDelayedFileReadClient(app.queryClient)
    context.onTestFinished(transport.restore)
    const first = document.querySelector<HTMLButtonElement>(
      '[data-retention-acceptance-intent="first"]',
    )
    const second = document.querySelector<HTMLButtonElement>(
      '[data-retention-acceptance-intent="survivor"]',
    )
    expect(first).not.toBeNull()
    expect(second).not.toBeNull()
    if (!first || !second) return
    expect(ForesightManager.instance.getManagerData.registeredElements.has(first)).toBe(true)
    expect(ForesightManager.instance.getManagerData.registeredElements.has(second)).toBe(true)
    await page.getByRole('button', { name: 'Open first', exact: true }).hover()
    await expect.poll(transport.observedStatus).toBe(200)
    second.focus()
    const shared = ensureFileSnapshotQuery(app.queryClient, path)
    app.setPredictions([{ slot: 'survivor', path }])
    const key = fileSnapshotQueryOptions(path).queryKey
    const held = app.queryClient.getQueryState(key)
    expect(held?.fetchStatus).toBe('fetching')
    await context.annotate(
      JSON.stringify({ point: 'first-caller-departed', query: held }),
      'retention-acceptance-interest-query',
    )
    transport.release()
    await shared
    await page.getByRole('button', { name: 'Open survivor', exact: true }).click()
    await awaitRetentionAcceptanceReady(app, path)
    const tab = activeEditorTab(app.read().workspace.getState().workbenchPanels.editorGroups)
    expect(tab).not.toBeNull()
    if (!tab) return
    const adopted = app.read().documents.getState().viewsByTabId[tab.id]
    expect(adopted?.preparedDocument).not.toBeNull()
    await context.annotate(
      JSON.stringify({
        point: 'remaining-prepared-stage-ids-after-activation',
        remainingRuntimeSessionIds: adopted?.preparedDocument?.runtimeSessionIds(),
      }),
      'retention-acceptance-prepared-stage-receipt',
    )
    const reference = retentionAcceptanceReference(app, path)
    const sample = captureRetentionAcceptancePaint(app, path, tab.id)
    await context.annotate(
      JSON.stringify({
        point: 'survivor-promoted',
        sample,
        reference,
        retention: retentionAcceptanceSubject(app, path).document.analysis.inspectRetention(),
      }),
      'retention-acceptance-interest-promotion',
    )
    assertRetentionAcceptancePaint(sample, reference, path)
    if (typeof commands.retentionAcceptanceScreenshot === 'function')
      await commands.retentionAcceptanceScreenshot('caller-promoted')
    app.setPredictions([])
    expect(app.read().documents.getState().viewsByTabId[tab.id]?.preparedDocument).toBe(
      adopted?.preparedDocument,
    )
    const reads = performance.getEntriesByType('resource').filter((entry) => {
      const url = new URL(entry.name)
      return url.pathname === '/fs/read' && url.searchParams.get('path') === path
    })
    expect(reads).toHaveLength(1)
    const transferred = retentionAcceptanceSubject(app, path).document
    expect(await app.read().commands.closeTab(tab.id)).toMatchObject({ status: 'applied' })
    await expect.poll(() => app.read().ui.getState().controllersByTabId.size).toBe(0)
    expect(app.read().documents.getState().viewsByTabId[tab.id]).toBeUndefined()
    expect(app.read().documents.getState().getLiveEditorDocument(transferred.key)).toBeNull()
    const released = transferred.analysis.inspectRetention()
    expect(
      released.entries.every(
        (entry) =>
          entry.leaseCount === 0 &&
          entry.displayDemand.preparationLeases === 0 &&
          entry.displayDemand.frames === 0,
      ),
    ).toBe(true)
    await context.annotate(
      JSON.stringify({ point: 'mounted-survivor-closed', released }),
      'retention-acceptance-interest-owner-release',
    )
  },
)

test(
  'the real caller deadline suppresses abandoned late admission while its joined query survives',
  { timeout: 45_000 },
  async (context) => {
    await commands.proofMouseHover({ selector: 'body', x: 850, y: 650 })
    const app = await mountRetentionAcceptanceApp([{ slot: 'expires', path }])
    const transport = installDelayedFileReadClient(app.queryClient)
    context.onTestFinished(transport.restore)
    const target = document.querySelector<HTMLButtonElement>(
      '[data-retention-acceptance-intent="expires"]',
    )
    expect(target).not.toBeNull()
    if (!target) return
    const events: { readonly type: string; readonly at: number }[] = []
    for (const type of ['pointerenter', 'pointerleave', 'focus', 'blur'])
      target.addEventListener(type, () => events.push({ type, at: Date.now() }))
    target.focus()
    const began = Date.now()
    await expect.poll(transport.observedStatus).toBe(200)
    const shared = ensureFileSnapshotQuery(app.queryClient, path)
    await new Promise<void>((resolve) =>
      setTimeout(resolve, Math.max(0, began + 30_001 - Date.now())),
    )
    expect(
      app.queryClient.getQueryState(fileSnapshotQueryOptions(path).queryKey)?.fetchStatus,
    ).toBe('fetching')
    transport.release()
    await shared
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
    const abandoned = app.read().interests.service.claimLive(path)
    await context.annotate(
      JSON.stringify({
        point: 'real-deadline-late-query',
        events,
        elapsedMs: Date.now() - began,
        claim: abandoned ? 'unexpected' : 'absent',
        query: app.queryClient.getQueryState(fileSnapshotQueryOptions(path).queryKey),
      }),
      'retention-acceptance-interest-expiry',
    )
    expect(abandoned).toBeNull()
  },
)

declare module 'vitest/browser' {
  interface BrowserCommands {
    proofMouseHover: (input: {
      readonly selector: string
      readonly x?: number
      readonly y?: number
    }) => Promise<void>
  }
}

declare module 'vitest/browser' {
  interface BrowserCommands {
    retentionAcceptanceScreenshot(label: string): Promise<string>
  }
}
