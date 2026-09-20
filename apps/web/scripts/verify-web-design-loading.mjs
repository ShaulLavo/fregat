import { settleAnimations } from './browser-animations.mjs'
import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect } from 'playwright/test'
import { createBenchmarkError } from './structured-errors.mjs'

export async function verifyDesignLoading(options) {
  const { page, fixture, appUrl, outputDir, density, colorScheme, capture } = options
  const variant = `${density}-${colorScheme}`
  const directory = join(outputDir, 'loading', variant)
  mkdirSync(directory, { recursive: true })
  const results = []
  const address = (document = 'f/alpha.ts', side = 'files') =>
    new URL(
      `~${fixture.workspace}/workbench/${document}?tabs=@~f/beta.ts&side=${side}&bottom=problems`,
      appUrl,
    ).href
  const editorTabs = () => page.getByRole('tablist', { name: 'Editor tabs', exact: true })
  const paneTitle = (title) =>
    page.locator('[data-workbench-tool-pane-header]').filter({ hasText: title }).first()
  const status = (label) => page.getByRole('status', { name: label, exact: true })
  const statusBar = (label) => status(label).locator('[data-slot="pane-bar"]').first()
  const retained = (name, locate, bar = true) => ({
    name,
    loading: locate,
    loaded: locate,
    retained: true,
    bar,
  })
  const sectionToolbar = (label) =>
    page
      .getByRole('textbox', { name: label, exact: true })
      .locator('xpath=ancestor::section[1]/div[1]')
  const bottomHeader = () =>
    page.getByRole('button', { name: 'Problems', exact: true }).locator('xpath=ancestor::header[1]')
  const picker = () => page.getByRole('dialog', { name: 'Choose folder', exact: true })
  const chatSocket = {
    url: '**/orchestration/rpc',
    method: 'subscribeSession',
    sessionId: fixture.sessionId,
  }
  const lanes = [
    {
      name: 'files',
      url: address(),
      paths: ['/fs/tree'],
      pending: () => status('Loading folder'),
      headers: [
        retained('Files pane title', () => paneTitle('Files')),
        {
          name: 'File tree toolbar',
          loading: () => statusBar('Loading folder'),
          loaded: () => page.getByRole('toolbar', { name: 'File tree actions', exact: true }),
          bar: true,
        },
      ],
      owner:
        'workspace/components/tree-pane.tsx:83; tree-loading.tsx:9; tree-toolbar.tsx:37; workbench/components/file-navigator-panel.tsx:37',
    },
    {
      name: 'git',
      url: address('f/alpha.ts', 'git'),
      paths: ['/git/status'],
      pending: () => status('Loading Git'),
      headers: [
        retained('Git pane title', () => paneTitle('Git')),
        {
          name: 'Git Changes header',
          loading: () => statusBar('Loading Git'),
          loaded: () =>
            page
              .getByRole('button', { name: /^Changes/ })
              .first()
              .locator('xpath=..'),
          bar: true,
        },
      ],
      owner:
        'git/components/panel.tsx:88; panel-loading.tsx:9; header.tsx:36; workbench/components/git-changes-panel.tsx:8',
    },
    {
      name: 'logs',
      url: address('f/alpha.ts', 'logs'),
      paths: ['/_log/dashboard/events', '/_log/dashboard/summary'],
      pending: () => status('Loading logs'),
      headers: [retained('Logs controls', () => sectionToolbar('Search logs'), false)],
      owner: 'logs/components/panel.tsx:89; event-list.tsx:57; toolbar.tsx:58',
    },
    {
      name: 'search',
      url: address('f/alpha.ts', 'search'),
      paths: ['/fs/search/events'],
      beforeLoading: () =>
        page
          .getByRole('searchbox', { name: 'Search workspace', exact: true })
          .fill('design verification'),
      pending: () => status('Searching'),
      headers: [
        retained(
          'Workspace search controls',
          () =>
            page
              .getByRole('searchbox', { name: 'Search workspace', exact: true })
              .locator('xpath=ancestor::section[1]/div[1]'),
          false,
        ),
      ],
      owner:
        'workspace/components/search-pane.tsx:44; search-controls.tsx:43; search/components/pending-or-empty.tsx:19',
    },
    {
      name: 'settings',
      url: address('settings'),
      paths: ['/settings'],
      streams: ['/settings/events'],
      pending: () => status('Loading settings'),
      headers: [
        retained('Settings editor tab strip', editorTabs),
        {
          name: 'Settings controls',
          loading: () => status('Loading settings').locator('header'),
          loaded: () =>
            page
              .getByRole('textbox', { name: 'Search settings', exact: true })
              .locator('xpath=ancestor::header[1]'),
          bar: false,
        },
      ],
      owner:
        'settings/components/page.tsx:99,124; page-loading.tsx:7; workbench/components/code-panel.tsx:42',
    },
    {
      name: 'editor-document',
      url: address(),
      paths: ['/fs/read'],
      pending: () => page.getByRole('status', { name: 'Loading file', exact: true }),
      headers: [retained('Editor document tab strip', editorTabs)],
      owner:
        'workbench/components/code-panel.tsx:42; file-editor-body.tsx:145; editor/hooks/use-selected-file.ts:15',
    },
    {
      name: 'chat-sidebar',
      url: `${address('f/alpha.ts', 'chat')}&chat=t/${fixture.sessionId}`,
      paths: ['/orchestration/session-detail'],
      socket: chatSocket,
      pending: () => page.getByRole('status').filter({ hasText: 'Syncing messages…' }),
      headers: [
        retained('Chat sidebar header', () =>
          page
            .getByRole('button', { name: 'New chat', exact: true })
            .locator('xpath=ancestor::header[1]'),
        ),
      ],
      owner:
        'chat/components/side-panel-content.tsx:76; chat-panel-header.tsx:35; chat-view.tsx:149',
    },
    {
      name: 'chat-stage',
      url: new URL(`~${fixture.workspace}/chat/t/${fixture.sessionId}?tool=git`, appUrl).href,
      paths: ['/orchestration/session-detail'],
      socket: chatSocket,
      pending: () => page.getByRole('status').filter({ hasText: 'Syncing messages…' }),
      headers: [
        retained('Chat stage header', () =>
          page.getByRole('navigation', { name: 'Session', exact: true }).locator('xpath=..'),
        ),
      ],
      owner:
        'chat-mode/components/chat-stage.tsx:78; stage-body.tsx:28; chat/components/chat-view.tsx:149',
    },
    {
      name: 'terminal',
      url: address().replace('bottom=problems', 'bottom=terminal'),
      paths: ['/orchestration/commands'],
      postType: 'project.create',
      pending: () => status('Opening terminal'),
      headers: [retained('Bottom panel header', bottomHeader)],
      owner:
        'workbench/components/bottom-panel.tsx:28; terminal/components/panel.tsx:310,369; terminal/state/register-checkout.ts:26',
    },
    {
      name: 'problems',
      url: address(),
      paths: [],
      socket: { url: (url) => url.pathname.endsWith('/lsp'), direction: 'server' },
      pending: () => status('Loading diagnostics'),
      headers: [retained('Problems bottom header', bottomHeader)],
      owner:
        'workbench/components/bottom-panel.tsx:28; diagnostics-panel.tsx:193; editor/language-server-status-source.ts:83',
    },
    {
      name: 'file-picker',
      url: address(),
      paths: ['/fs/tree'],
      afterNavigation: true,
      beforeLoading: async () => {
        await page.getByRole('button', { name: 'Switch project', exact: true }).click()
        await page.getByRole('menuitem', { name: 'Open folder…', exact: true }).click()
      },
      pending: () => picker().getByRole('status', { name: 'Loading folder', exact: true }),
      headers: [
        retained('Picker path bar', () =>
          picker().locator('[aria-label="Folder history"]').locator('xpath=..'),
        ),
        retained(
          'Picker list columns',
          () => picker().locator('[aria-label="File list sorting"]'),
          false,
        ),
        retained('Picker footer', () =>
          picker()
            .getByRole('button', { name: 'Cancel', exact: true })
            .locator('xpath=ancestor::*[contains(@class,"h-(--bar-height)")][1]'),
        ),
      ],
      owner: 'components/file-picker-dialog.tsx:459,587,619; features/file-picker/list.tsx:195,295',
    },
    {
      name: 'model-picker',
      url: address('f/alpha.ts', 'chat'),
      paths: ['/providers'],
      beforeLoading: () =>
        page.getByRole('button', { name: 'Provider and model', exact: true }).click(),
      pending: () => status('Loading providers'),
      headers: [
        retained(
          'Model picker search field',
          () => page.getByPlaceholder('Search models', { exact: true }).locator('xpath=..'),
          false,
        ),
      ],
      owner:
        'chat/components/model-picker.tsx:136,149,165; model-picker-trigger.tsx:37; models-loading.tsx:10',
    },
  ]
  lanes.push({
    ...lanes.find((lane) => lane.name === 'settings'),
    name: 'settings-narrow',
    viewport: { width: 900, height: 1000 },
  })

  for (const lane of lanes.filter((lane) => !options.panes || options.panes.includes(lane.name))) {
    const result = {
      name: lane.name,
      density,
      colorScheme,
      owner: lane.owner,
      status: 'pending',
      headers: [],
    }
    results.push(result)
    let gate
    const previousViewport = page.viewportSize()
    const socket = lane.socket ? await holdSocket(page, lane.socket) : null
    const terminal = lane.name === 'terminal' ? await ownTerminal(page, fixture) : null
    const pendingHandles = []
    let sidebarPosition
    try {
      if (lane.viewport) await page.setViewportSize(lane.viewport)
      if (!lane.afterNavigation)
        gate = await holdResponses(page, lane.paths, lane.streams ?? [], appUrl, lane.postType)
      await page.goto(lane.url, { waitUntil: 'domcontentloaded' })
      if (lane.afterNavigation) {
        await editorTabs().waitFor()
        gate = await holdResponses(page, lane.paths, lane.streams ?? [], appUrl, lane.postType)
      }
      await lane.beforeLoading?.()
      await lane.pending().waitFor({ state: 'visible', timeout: 15_000 })
      if (lane.viewport) {
        sidebarPosition = await resizeSettingsPane(page, 120)
        await expect
          .poll(() => geometry(lane.headers[1].loading()))
          .toMatchObject({ display: 'grid' })
      }
      await expect
        .poll(() => gate.responses.length + (socket?.responses.length ?? 0))
        .toBeGreaterThan(0)
      await expect
        .poll(() =>
          page.evaluate(() => ({
            density: document.documentElement.dataset.density,
            dark: document.documentElement.classList.contains('dark'),
          })),
        )
        .toEqual({ density, dark: colorScheme === 'dark' })
      await settleAnimations(page)
      for (const header of lane.headers) {
        await header.loading().waitFor({ state: 'visible' })
        pendingHandles.push(await header.loading().elementHandle())
        result.headers.push({
          name: header.name,
          lifetime: header.retained ? 'retained' : 'replaced',
          loading: await geometry(header.loading(), Boolean(lane.viewport)),
        })
      }
      await page.screenshot({ path: join(directory, `${lane.name}-loading.png`) })
      if (capture) result.loadingCapture = await capture(`loading-${lane.name}-pending`)
      await gate.release()
      socket?.release()
      await lane.pending().waitFor({ state: 'hidden', timeout: 20_000 })
      if (terminal) await terminal.ready()
      await settleAnimations(page)
      for (let index = 0; index < lane.headers.length; index++) {
        const header = lane.headers[index]
        const measurement = result.headers[index]
        await header.loaded().waitFor({ state: 'visible' })
        measurement.loaded = await geometry(header.loaded(), Boolean(lane.viewport))
        measurement.sameNode = await header
          .loaded()
          .evaluate((element, previous) => element === previous, pendingHandles[index])
        measurement.differences = geometryDifferences(
          measurement.loading,
          measurement.loaded,
          header.bar,
          density,
        )
        if (header.retained && !measurement.sameNode)
          measurement.differences.push('retained header DOM node was replaced')
      }
      await page.screenshot({ path: join(directory, `${lane.name}-loaded.png`) })
      if (capture) result.loadedCapture = await capture(`loading-${lane.name}-resolved`)
      result.status = result.headers.some((header) => header.differences.length)
        ? 'failed'
        : 'passed'
    } catch (error) {
      result.status = 'failed'
      result.error = error.message
      await page.screenshot({ path: join(directory, `${lane.name}-failure.png`) }).catch(() => {})
    } finally {
      await gate?.release()
      socket?.release()
      if (terminal) result.cleanup = await terminal.dispose()
      if (result.cleanup?.some((item) => item.status !== 'passed')) result.status = 'failed'
      for (const handle of pendingHandles) await handle?.dispose()
      result.responses = [...(gate?.responses ?? []), ...(socket?.responses ?? [])]
      result.routeErrors = gate?.errors ?? []
      if (result.routeErrors.length) result.status = 'failed'
      writeFileSync(join(directory, 'results.json'), JSON.stringify(results, null, 2) + '\n')
      if (sidebarPosition !== undefined) await restoreSidebar(page, sidebarPosition)
      if (lane.viewport) await page.setViewportSize(previousViewport)
    }
  }
  return results
}

async function resizeSettingsPane(page, distance) {
  const handle = page.locator('#sidebar-handle')
  const box = await handle.boundingBox()
  const original = (await geometry(handle, true)).x
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.mouse.move(box.x + box.width / 2 + distance, box.y + box.height / 2, { steps: 8 })
  await page.mouse.up()
  await settleAnimations(page)
  return original
}

async function restoreSidebar(page, original) {
  const box = await page.locator('#sidebar-handle').boundingBox()
  if (!box) return
  const current = (await geometry(page.locator('#sidebar-handle'), true)).x
  await resizeSettingsPane(page, original - current)
}

async function geometry(locator, documentCoordinates = false) {
  return locator.evaluate((element, useDocumentCoordinates) => {
    const rectangle = element.getBoundingClientRect()
    const style = getComputedStyle(element)
    const scrollers = []
    let ancestor = element.parentElement
    while (ancestor) {
      if (ancestor.scrollLeft || ancestor.scrollTop)
        scrollers.push({
          element: ancestor.tagName,
          className: ancestor.className,
          x: ancestor.scrollLeft,
          y: ancestor.scrollTop,
        })
      ancestor = ancestor.parentElement
    }
    const scrollX = scrollers.reduce((total, item) => total + item.x, 0)
    const scrollY = scrollers.reduce((total, item) => total + item.y, 0)
    return {
      x: rectangle.x + (useDocumentCoordinates ? scrollX : 0),
      y: rectangle.y + (useDocumentCoordinates ? scrollY : 0),
      viewportX: rectangle.x,
      viewportY: rectangle.y,
      scrollX,
      scrollY,
      scrollers,
      coordinateSystem: useDocumentCoordinates ? 'document' : 'viewport',
      width: rectangle.width,
      height: rectangle.height,
      borderTop: style.borderTopWidth,
      borderBottom: style.borderBottomWidth,
      borderRadius: style.borderRadius,
      display: style.display,
      barToken: getComputedStyle(document.documentElement).getPropertyValue('--bar-height').trim(),
    }
  }, documentCoordinates)
}

function geometryDifferences(before, after, bar, density) {
  const differences = []
  for (const field of ['x', 'y', 'width', 'height']) {
    if (Math.abs(before[field] - after[field]) > 0.5)
      differences.push(`${field}: ${before[field]} → ${after[field]}`)
  }
  for (const field of ['borderTop', 'borderBottom', 'borderRadius']) {
    if (before[field] !== after[field])
      differences.push(`${field}: ${before[field]} → ${after[field]}`)
  }
  const height = density === 'compact' ? 36 : 40
  if (bar && (Math.abs(before.height - height) > 0.5 || Math.abs(after.height - height) > 0.5)) {
    differences.push(`expected ${height}px bar in both states`)
  }
  return differences
}

async function holdResponses(page, paths, streams, appUrl, postType) {
  const responses = []
  const errors = []
  const operations = new Set()
  let unlock
  let released = false
  const barrier = new Promise((resolve) => {
    unlock = resolve
  })
  const matches = (path, candidates) => candidates.some((candidate) => path.endsWith(candidate))
  const handler = async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname
    if (request.isNavigationRequest() || (!matches(path, paths) && !matches(path, streams)))
      return route.continue()
    if (postType && (request.method() !== 'POST' || request.postDataJSON()?.type !== postType))
      return route.continue()
    if (!postType && request.method() !== 'GET') return route.continue()
    const operation = deliver(route, path)
    operations.add(operation)
    await operation
    operations.delete(operation)
  }
  async function deliver(route, path) {
    try {
      if (matches(path, streams)) {
        responses.push({ url: route.request().url(), kind: 'held stream request' })
        await barrier
        await route.continue()
        return
      }
      const response = await route.fetch({
        headers: { ...route.request().headers(), Origin: new URL(appUrl).origin },
      })
      const body = await response.body()
      responses.push({
        url: route.request().url(),
        status: response.status(),
        bytes: body.length,
        sha256: createHash('sha256').update(body).digest('hex'),
        kind: 'unchanged real HTTP response',
      })
      if (!response.ok())
        throw createBenchmarkError(
          `Loading proof request returned HTTP${response.status()}: ${route.request().url()}`,
        )
      await barrier
      await route.fulfill({ response })
    } catch (error) {
      errors.push(error.message)
      await route.abort().catch(() => {})
    }
  }
  await page.route('**/*', handler)
  return {
    responses,
    errors,
    async release() {
      if (released) return
      released = true
      unlock()
      await Promise.allSettled(operations)
      await page.unroute('**/*', handler)
    },
  }
}

async function ownTerminal(page, fixture) {
  const connections = []
  let active = true
  await page.routeWebSocket(
    (url) => url.pathname.endsWith('/terminal'),
    (socket) => {
      const server = socket.connectToServer()
      const url = new URL(socket.url())
      if (
        !active ||
        url.searchParams.get('worktreeId') !== fixture.worktreeId ||
        url.searchParams.get('terminalId') !== 'terminal-1'
      )
        return
      const entry = { url: socket.url(), ready: false, closed: false, server }
      connections.push(entry)
      server.onMessage((message) => {
        if (typeof message === 'string' && message.startsWith('{')) {
          const frame = JSON.parse(message)
          if (frame.type === 'ready') entry.ready = true
        }
        socket.send(message)
      })
      server.onClose((code, reason) => {
        entry.closed = true
        void socket.close({ code, reason })
      })
    },
  )
  return {
    async ready() {
      await expect
        .poll(() => connections.some((entry) => entry.ready), { timeout: 15_000 })
        .toBe(true)
    },
    async dispose() {
      active = false
      const cleanup = []
      for (const entry of connections) {
        if (!entry.closed) entry.server.send(JSON.stringify({ type: 'dispose' }))
        try {
          await expect.poll(() => entry.closed, { timeout: 15_000 }).toBe(true)
          cleanup.push({
            url: entry.url,
            action: 'terminal dispose protocol and server socket closure',
            status: 'passed',
          })
        } catch (error) {
          cleanup.push({
            url: entry.url,
            action: 'terminal dispose protocol and server socket closure',
            status: 'failed',
            error: error.message,
          })
        }
      }
      return cleanup
    },
  }
}

async function holdSocket(page, rule) {
  const responses = []
  const queued = []
  let active = true
  await page.routeWebSocket(rule.url, (socket) => {
    const server = socket.connectToServer()
    if (!active) return
    const receive = rule.direction === 'server' ? server : socket
    const destination = rule.direction === 'server' ? socket : server
    receive.onMessage((message) => {
      let matches = rule.direction === 'server'
      if (rule.method) {
        const frame = JSON.parse(String(message))
        matches = frame.method === rule.method && frame.sessionId === rule.sessionId
      }
      if (!active || !matches) return destination.send(message)
      responses.push({
        url: socket.url(),
        kind: 'unchanged real WebSocket frame',
        direction: rule.direction ?? 'client',
        bytes: Buffer.byteLength(message),
        sha256: createHash('sha256').update(message).digest('hex'),
      })
      queued.push(() => destination.send(message))
    })
  })
  return {
    responses,
    release() {
      if (!active) return
      active = false
      for (const forward of queued) forward()
    },
  }
}
