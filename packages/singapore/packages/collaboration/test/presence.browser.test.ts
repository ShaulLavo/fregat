import { afterEach, expect, test, vi } from 'vitest'
import { page, commands } from 'vitest/browser'
import { Editor } from '@singapore-editor/core/editor'
import type { EditorPlugin } from '@singapore-editor/core/extensions'
import { Presence, type PresenceChannel } from '../src/presence'
import { Session } from '../src/session'
import { BrowserEngine, browserGenesis } from './browser-engine'
import { createPresencePlugin } from '../src/presence-plugin'
import { presenceNetwork, ReferenceResolver, remoteState } from './presence-fixtures'
import '@singapore-editor/core/style.css'

declare module 'vitest/browser' {
  interface BrowserCommands {
    presenceMotion(reduced: boolean): Promise<void>
  }
}

const editors: Editor[] = []
const hosts: HTMLElement[] = []
afterEach(() => {
  for (const editor of editors.splice(0)) editor.dispose()
  for (const host of hosts.splice(0)) host.remove()
  vi.restoreAllMocks()
})

function mount(
  text: string,
  wordWrap = true,
  extra: readonly EditorPlugin[] = [],
  channel?: PresenceChannel,
) {
  const host = document.createElement('div')
  host.style.cssText =
    'display:flex;flex-direction:column;width:500px;height:340px;margin:30px;background:#fafafa'
  document.body.append(host)
  hosts.push(host)
  const presence = new Presence('local', 'document', channel)
  const resolver = new ReferenceResolver(text)
  const editor = new Editor(host, {
    wordWrap,
    wordWrapBreak: 'word',
    lineHeight: 24,
    plugins: extra.concat([createPresencePlugin({ presence, resolver })]),
  })
  editor.setText(text)
  editors.push(editor)
  return { host, editor, presence, resolver }
}

function carets(host: HTMLElement): HTMLElement[] {
  return Array.from(host.querySelectorAll<HTMLElement>('.editor-remote-caret'))
}

function show(
  presence: Presence,
  resolver: ReferenceResolver,
  name: string,
  peer: string,
  anchor: number,
  head: number,
  colour = '#3775c5',
  clock = 1,
) {
  presence.receive(peer, {
    clock,
    state: {
      ...remoteState(peer, clock),
      displayName: name,
      colour,
      selections: [{ anchor: resolver.gap(anchor), head: resolver.gap(head) }],
    },
  })
}

const TEXT =
  'Shared document\n' +
  'A wrapped paragraph keeps remote selections on the words as the viewport gets narrower. '.repeat(
    3,
  ) +
  '\nfunction folded() {\n  hidden one\n  hidden two\n}\nAfter the fold, both cursors keep their character identities.\n'

test('paints two named remote carets and a selection across wrapped rows on the simple API', async () => {
  const { host, presence, resolver } = mount(TEXT)
  await expect
    .poll(() => host.querySelectorAll('.editor-virtualized-row').length)
    .toBeGreaterThan(5)
  show(presence, resolver, 'Ada', 'ada', 25, 120)
  show(presence, resolver, 'Grace Hopper with a longer name', 'grace', 170, 170, '#ad4385')
  await expect.poll(() => carets(host).length).toBe(2)
  expect(host.querySelectorAll('.editor-remote-name')).toHaveLength(2)
  const labels = Array.from(host.querySelectorAll<HTMLElement>('.editor-remote-name'))
  expect(labels.map((label) => label.textContent)).toEqual([
    'Ada',
    'Grace Hopper with a longer name',
  ])
  expect(labels[1]!.title).toBe('Grace Hopper with a longer name')
  expect(labels[1]!.scrollWidth).toBeGreaterThan(labels[1]!.clientWidth)
  expect(getComputedStyle(labels[1]!).transitionDuration).toBe('0s')
  expect(getComputedStyle(labels[1]!).pointerEvents).toBe('auto')
  const highlights = Array.from(CSS.highlights.keys()).filter((name) => name.includes('presence'))
  expect(highlights.length).toBeGreaterThan(0)
  for (const name of highlights) expect(CSS.supports(`selector(::highlight(${name}))`)).toBe(true)
  const row = host.querySelector('.editor-virtualized-row')!
  expect(getComputedStyle(row, `::highlight(${highlights[0]})`).backgroundColor).toContain(
    '55, 117, 197',
  )
  for (const caret of carets(host)) {
    const rect = caret.getBoundingClientRect()
    expect(rect.height).toBeGreaterThan(10)
    expect(rect.left).toBeGreaterThan(host.getBoundingClientRect().left)
    expect(rect.right).toBeLessThan(host.getBoundingClientRect().right)
  }
  await page.screenshot({ element: host, path: '../.vitest/evidence/presence-wrapped.png' })
})

test('a one-second router link blip preserves the named caret and refreshes unchanged presence', async () => {
  const network = presenceNetwork()
  const receiver = network.peers[0]!
  const sender = network.peers[1]!
  const { host, presence, resolver } = mount(TEXT, true, [], receiver.session)
  try {
    network.connect()
    sender.presence.setLocalState({
      ...remoteState(),
      selections: [{ anchor: resolver.gap(25), head: resolver.gap(120) }],
    })
    network.flush()
    await expect.poll(() => carets(host).length).toBe(1)
    const counts: number[] = []
    presence.subscribe(() => counts.push(presence.states.length))
    const clock = presence.states[0]!.presenceClock
    await page.screenshot({ element: host, path: '../.vitest/evidence/presence-blip-before.png' })
    network.tick(1_000)
    network.disconnect()
    await page.screenshot({ element: host, path: '../.vitest/evidence/presence-blip-during.png' })
    await expect.poll(() => carets(host).length).toBe(1)
    expect(receiver.session.members.has(sender.session.peer)).toBe(true)
    network.tick(2_000)
    network.connect()
    expect(presence.states[0]?.presenceClock).toBeGreaterThan(clock)
    await expect.poll(() => carets(host).length).toBe(1)
    expect(counts).not.toContain(0)
    expect(host.querySelector('.editor-remote-name')?.textContent).toBe('Ada')
    await page.screenshot({ element: host, path: '../.vitest/evidence/presence-blip-after.png' })
  } finally {
    presence.dispose()
    network.dispose()
  }
})

test('membership removal clears the crashed peer caret, name and selection before awareness expiry', async () => {
  const session = new Session({
    peer: 'local',
    room: 'room',
    document: 'document',
    genesis: browserGenesis,
    engine: new BrowserEngine(),
    send() {},
    pulseInterval: 100,
    suspicionTimeout: 300,
    dependencyTimeout: 500,
    historyChunkRecords: 10,
  })
  session.connect('crashed')
  session.connect('retained')
  const { host, presence, resolver } = mount(TEXT, true, [], session)
  let messageId = 0
  const receive = (peer: string, clock: number, anchor: number, head: number) =>
    session.receive({
      version: 1,
      room: 'room',
      document: 'document',
      sender: peer,
      epoch: 'epoch',
      messageId: ++messageId,
      type: 'PRESENCE',
      payload: {
        clock,
        state: {
          ...remoteState(peer, clock),
          displayName: peer === 'crashed' ? 'Ada' : 'Grace',
          selections: [{ anchor: resolver.gap(anchor), head: resolver.gap(head) }],
        },
      },
    })
  try {
    expect(receive('crashed', 7, 25, 120)).toBe(true)
    expect(receive('retained', 1, 170, 170)).toBe(true)
    await expect.poll(() => carets(host).length).toBe(2)
    const highlightNames = Array.from(CSS.highlights.keys()).filter((name) =>
      name.includes('presence'),
    )
    expect(highlightNames.length).toBeGreaterThan(0)
    expect(host.querySelector('.editor-remote-name')?.textContent).toBe('Ada')
    await page.screenshot({ element: host, path: '../.vitest/evidence/presence-crash-before.png' })
    expect(receive('crashed', 8, 30, 140)).toBe(true)
    session.disconnect('crashed')
    expect(session.members.has('crashed')).toBe(true)
    session.tick(300)
    expect(session.members.has('crashed')).toBe(false)
    await page.screenshot({ element: host, path: '../.vitest/evidence/presence-crash-removed.png' })
    await expect
      .poll(() => carets(host).map((caret) => caret.dataset.peerSessionId))
      .toEqual(['retained'])
    expect(
      Array.from(host.querySelectorAll('.editor-remote-name'), (name) => name.textContent),
    ).toEqual(['Grace'])
    for (const name of highlightNames) expect(CSS.highlights.has(name)).toBe(false)
    session.tick(350)
    expect(presence.states.map((state) => state.peerSessionId)).toEqual(['retained'])
    expect(receive('crashed', 9, 30, 140)).toBe(false)
    await page.screenshot({ element: host, path: '../.vitest/evidence/presence-crash-after.png' })
  } finally {
    presence.dispose()
  }
})

test('folding hides an interior caret and keeps a selection and both names aligned after unfolding', async () => {
  const { host, editor, presence, resolver } = mount(TEXT)
  const start = TEXT.indexOf('function folded()')
  const end = TEXT.indexOf('\n}', start) + 2
  const hidden = TEXT.indexOf('hidden one') + 3
  const after = TEXT.indexOf('After the fold') + 10
  editor.setSyntaxFolds([
    {
      startIndex: start + 'function folded() {'.length - 1,
      endIndex: end,
      startLine: 2,
      endLine: 5,
      type: 'block',
    },
  ])
  editor.setScrollPosition({ top: 0 })
  show(presence, resolver, 'Ada', 'ada', start + 3, after)
  show(presence, resolver, 'Grace', 'grace', hidden, hidden, '#ad4385')
  await expect.poll(() => carets(host).length).toBe(2)
  expect(editor.fold(start + 3)).toBe(true)
  await expect.poll(() => carets(host).length).toBe(1)
  expect(carets(host)[0]!.dataset.peerSessionId).toBe('ada')
  expect(presence.states).toHaveLength(2)
  await page.screenshot({ element: host, path: '../.vitest/evidence/presence-folded.png' })
  expect(editor.unfold(start + 3)).toBe(true)
  await expect.poll(() => carets(host).length).toBe(2)
  await page.screenshot({ element: host, path: '../.vitest/evidence/presence-unfolded.png' })
})

test('follows horizontal scroll and renders names as text; clears owned paint on expiry', async () => {
  const text = 'header\n' + 'long horizontal content '.repeat(80)
  const { host, editor, presence, resolver } = mount(text, false)
  show(presence, resolver, '<img src=x onerror=alert(1)>', 'ada) { body { color: red } }', 9, 60)
  show(presence, resolver, 'Grace', 'grace', 50, 50, '#ad4385')
  await expect.poll(() => carets(host).length).toBe(2)
  expect(host.querySelector('.editor-remote-name img')).toBeNull()
  const before = carets(host)[0]!.getBoundingClientRect().left
  editor.setScrollPosition({ left: 100 })
  await expect
    .poll(() => carets(host)[0]!.getBoundingClientRect().left)
    .toBeCloseTo(before - 100, 0)
  await page.screenshot({ element: host, path: '../.vitest/evidence/presence-horizontal.png' })
  presence.tick(30_000)
  await expect.poll(() => carets(host).length).toBe(0)
  expect(
    Array.from(CSS.highlights.keys()).filter((name) => name.includes('presence')),
  ).toHaveLength(0)
})

test('unresolvable gaps stay retained and paint after their character edit arrives', async () => {
  const { host, editor, presence, resolver } = mount('header\nab')
  const gap = {
    left: { bunch: 'later:0', counter: 0 },
    right: { bunch: 'seed:0', counter: 8 },
    bias: 'left' as const,
  }
  const state = { ...remoteState(), selections: [{ anchor: gap, head: gap }] }
  presence.receive('remote', { clock: 1, state })
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  )
  expect(carets(host)).toHaveLength(0)
  expect(presence.states[0]!.selections).toEqual(state.selections)
  resolver.engine.apply({
    document: 'document',
    epoch: 'epoch',
    id: { actor: 'later', seq: 0 },
    lamport: 1,
    deps: [],
    change: {
      kind: 'insert',
      start: gap.left,
      originLeft: { bunch: 'seed:0', counter: 7 },
      originRight: gap.right,
      text: 'X',
    },
  })
  editor.setText(resolver.engine.text())
  await expect.poll(() => carets(host).length).toBe(1)
})

test.each([0, 100, 1000])(
  '%i inert plugins receive zero content, selection or viewport callbacks',
  async (count) => {
    const update = vi.fn()
    const inert = Array.from({ length: count }, (): EditorPlugin => ({
      activate: (context) =>
        context.registerViewContribution({
          createContribution: () => ({ inputs: [], update, dispose() {} }),
        }),
    }))
    const { editor, host } = mount('header\nbody', true, inert)
    await expect
      .poll(() => host.querySelectorAll('.editor-virtualized-row').length)
      .toBeGreaterThan(0)
    update.mockClear()
    editor.syncText('header\nbxody')
    editor.setSelection(9, 9)
    editor.setScrollPosition({ top: 10 })
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    )
    expect(update).not.toHaveBeenCalled()
    expect(host.querySelector('.editor-remote-presence')).toBeNull()
  },
)

test('idle labels hide after two seconds, remain hidden on renewal and reveal on caret hover', async () => {
  const { host, presence, resolver } = mount(TEXT)
  show(presence, resolver, 'Ada', 'ada', 25, 120)
  await expect.poll(() => carets(host).length).toBe(1)
  const label = () => host.querySelector<HTMLElement>('.editor-remote-name')!
  expect(getComputedStyle(label()).opacity).toBe('1')
  await new Promise((resolve) => setTimeout(resolve, 2_250))
  expect(getComputedStyle(label()).opacity).toBe('0')
  expect(getComputedStyle(label()).transitionDuration).not.toBe('0s')
  expect(getComputedStyle(label()).transitionProperty).toBe('opacity')
  expect(carets(host)).toHaveLength(1)
  await page.screenshot({ element: host, path: '../.vitest/evidence/presence-idle.png' })
  presence.tick(15_000)
  show(presence, resolver, 'Ada', 'ada', 25, 120, '#3775c5', 2)
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(getComputedStyle(label()).opacity).toBe('0')
  await page.elementLocator(carets(host)[0]!).hover()
  await expect.poll(() => getComputedStyle(label()).opacity).toBe('1')
  await page.screenshot({ element: host, path: '../.vitest/evidence/presence-hover.png' })
  await page.getByText('Shared document', { exact: true }).hover()
  presence.tick(15_050)
  show(presence, resolver, 'Ada', 'ada', 25, 130, '#3775c5', 3)
  await expect.poll(() => getComputedStyle(label()).opacity).toBe('1')
  await new Promise((resolve) => setTimeout(resolve, 2_250))
  expect(getComputedStyle(label()).opacity).toBe('0')
  presence.tick(15_100)
  show(presence, resolver, 'Ada', 'ada', 35, 130, '#3775c5', 4)
  await expect.poll(() => getComputedStyle(label()).opacity).toBe('1')
}, 10_000)

test('presence bursts request at most one overlay repaint per animation frame', async () => {
  const { host, presence, resolver } = mount(TEXT)
  show(presence, resolver, 'Ada', 'ada', 25, 120)
  await expect.poll(() => carets(host).length).toBe(1)
  const root = host.querySelector('.editor-remote-presence')!
  const replace = vi.spyOn(root, 'replaceChildren')
  for (let clock = 2; clock <= 251; clock++) {
    presence.tick(clock * 50)
    show(presence, resolver, 'Ada', 'ada', 25, 120 + (clock % 10), '#3775c5', clock)
  }
  expect(replace).not.toHaveBeenCalled()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(replace.mock.calls.length).toBeLessThanOrEqual(1)
  expect(presence.states[0]!.presenceClock).toBe(251)
})

test('reduced motion hides idle labels instantly while the caret stays visible', async () => {
  await commands.presenceMotion(true)
  try {
    const { host, presence, resolver } = mount(TEXT)
    show(presence, resolver, 'Ada', 'ada', 25, 120)
    await expect.poll(() => carets(host).length).toBe(1)
    const label = () => host.querySelector<HTMLElement>('.editor-remote-name')!
    expect(getComputedStyle(label()).transitionDuration).toBe('0s')
    await new Promise((resolve) => setTimeout(resolve, 2_010))
    expect(label().isConnected).toBe(true)
    expect(getComputedStyle(label()).opacity).toBe('0')
    expect(getComputedStyle(label()).transitionDuration).toBe('0s')
    expect(carets(host)).toHaveLength(1)
    await page.screenshot({
      element: host,
      path: '../.vitest/evidence/presence-reduced-motion.png',
    })
  } finally {
    await commands.presenceMotion(false)
  }
})

test('disposing a view cancels pending presence frames and label deadlines', async () => {
  const { host, editor, presence, resolver } = mount(TEXT)
  show(presence, resolver, 'Ada', 'ada', 25, 120)
  await expect.poll(() => carets(host).length).toBe(1)
  const cancelFrame = vi.spyOn(window, 'cancelAnimationFrame')
  const cancelDeadline = vi.spyOn(window, 'clearTimeout')
  presence.tick(50)
  show(presence, resolver, 'Ada', 'ada', 25, 130, '#3775c5', 2)
  editor.dispose()
  expect(cancelFrame).toHaveBeenCalled()
  expect(cancelDeadline).toHaveBeenCalled()
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  expect(host.querySelector('.editor-remote-presence')).toBeNull()
})
