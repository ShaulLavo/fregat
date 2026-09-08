import { createCommandHarness } from '../../../test/commands'
import { expect, test } from '../../../test/fixtures'

test('overlay close restores captured focus and an unmounted origin falls back to the current screen', () => {
  const harness = createCommandHarness({ handlers: {} })
  try {
    const origin = harness.focus.capture()
    const overlay = harness.focus.register({
      ...harness.scope,
      id: 'dialog',
      area: 'dialog',
      overlay: true,
      textEntry: true,
      focus: () => true,
      isFocused: () => true,
    })
    harness.focus.activate(overlay.token)
    expect(harness.focus.restore(origin)).toBe(true)
    expect(harness.focus.capture()).toBe(overlay.token)
    expect(harness.focus.getSnapshot().requested?.target).toBeNull()
    overlay.unregister()
    expect(harness.focus.capture()).toBe(origin)
    harness.target.unregister()
    const fallback = harness.focus.register({
      ...harness.scope,
      id: 'settings-list',
      area: 'settings',
      textEntry: false,
      focus: () => true,
      isFocused: () => true,
    })
    expect(harness.focus.restore(origin)).toBe(true)
    expect(harness.focus.capture()).toBe(fallback.token)
  } finally {
    harness.dispose()
  }
})

test('an overlay holds background requests and native activation until it becomes unavailable', async () => {
  const harness = createCommandHarness({ handlers: {} })
  let available = true
  let overlayFocuses = 0
  try {
    const overlay = harness.focus.register({
      ...harness.scope,
      id: 'dialog',
      area: 'dialog',
      overlay: true,
      textEntry: true,
      get available() {
        return available
      },
      focus: () => {
        overlayFocuses += 1
        return true
      },
      isFocused: () => true,
    })
    harness.focus.activate(overlay.token)
    const request = harness.focus.request({ kind: 'target', token: harness.target.token })
    expect(harness.focus.getSnapshot().requested).toMatchObject({
      token: request.token,
      target: null,
    })
    expect(harness.focus.activate(harness.target.token)).toBe(false)
    expect(overlayFocuses).toBe(1)
    expect(harness.focus.capture()).toBe(overlay.token)
    expect(harness.focus.getSnapshot().lastCommandTarget?.token).toBe(harness.target.token)
    available = false
    harness.focus.refreshAvailability(overlay.token)
    expect(await request.completion).toMatchObject({ status: 'acknowledged' })
    expect(harness.focus.capture()).toBe(harness.target.token)
  } finally {
    harness.dispose()
  }
})

test('opening an overlay hides a background target that is still waiting for native focus', async () => {
  const harness = createCommandHarness({ handlers: {} })
  let focused = false
  try {
    const target = harness.focus.register({
      ...harness.scope,
      id: 'delayed-widget',
      area: 'editor',
      textEntry: false,
      focus: () => true,
      isFocused: () => focused,
    })
    const request = harness.focus.request({ kind: 'target', token: target.token })
    expect(harness.focus.getSnapshot().requested?.target?.token).toBe(target.token)
    const overlay = harness.focus.register({
      ...harness.scope,
      id: 'dialog',
      area: 'dialog',
      overlay: true,
      textEntry: true,
      focus: () => true,
      isFocused: () => true,
    })
    harness.focus.activate(overlay.token)
    expect(harness.focus.getSnapshot().requested?.target).toBeNull()
    expect(harness.focus.capture()).toBe(overlay.token)
    focused = true
    overlay.unregister()
    expect(await request.completion).toMatchObject({ status: 'acknowledged' })
    expect(harness.focus.capture()).toBe(target.token)
  } finally {
    harness.dispose()
  }
})

test('pane cycling wraps and excludes overlays and other environments', () => {
  const harness = createCommandHarness({ handlers: {} })
  try {
    const second = harness.focus.register({
      ...harness.scope,
      id: 'details',
      area: 'settings',
      textEntry: false,
      focus: () => true,
      isFocused: () => true,
    })
    harness.focus.register({
      ...harness.scope,
      id: 'dialog',
      area: 'dialog',
      overlay: true,
      textEntry: true,
      focus: () => true,
      isFocused: () => true,
    })
    harness.focus.register({
      ...harness.scope,
      environmentId: 'environment-b',
      id: 'other',
      area: 'settings',
      textEntry: false,
      focus: () => true,
      isFocused: () => true,
    })
    harness.focus.cycle(-1)
    expect(harness.focus.capture()).toBe(second.token)
    harness.focus.cycle(1)
    expect(harness.focus.capture()).toBe(harness.target.token)
  } finally {
    harness.dispose()
  }
})

test('active child mounting before its parent scope effect retains actual focus', () => {
  const harness = createCommandHarness({ handlers: {} })
  try {
    const scope = { ...harness.scope, screen: 'files' }
    const target = harness.focus.register({
      ...scope,
      id: 'files',
      area: 'file-tree',
      textEntry: true,
      focus: () => true,
      isFocused: () => true,
    })
    expect(harness.focus.activate(target.token)).toBe(false)
    harness.focus.setScope(scope)
    expect(harness.focus.capture()).toBe(target.token)
    expect(harness.focus.getSnapshot().current?.capabilities.textEntry).toBe(true)
  } finally {
    harness.dispose()
  }
})

test('focus requests acknowledge actual focus rather than an accepted intent', async () => {
  const harness = createCommandHarness({ handlers: {} })
  let focused = false
  try {
    const target = harness.focus.register({
      ...harness.scope,
      id: 'delayed-widget',
      area: 'settings',
      textEntry: false,
      focus: () => true,
      isFocused: () => focused,
    })
    const ticket = harness.focus.request({ kind: 'target', token: target.token })
    expect(harness.focus.getSnapshot().requested?.token).toBe(ticket.token)
    expect(harness.focus.capture()).toBe(harness.target.token)
    focused = true
    harness.focus.activate(target.token)
    expect(await ticket.completion).toEqual({
      status: 'acknowledged',
      targetId: { kind: 'tui-widget', key: 'delayed-widget' },
    })
    expect(harness.focus.getSnapshot().requested).toBeNull()
  } finally {
    harness.dispose()
  }
})

test('new requests supersede pending transitions and unmount rejects their destination', async () => {
  const harness = createCommandHarness({ handlers: {} })
  try {
    const target = harness.focus.register({
      ...harness.scope,
      id: 'delayed-widget',
      area: 'settings',
      textEntry: false,
      focus: () => true,
      isFocused: () => false,
    })
    const first = harness.focus.request({ kind: 'target', token: target.token })
    const second = harness.focus.request({ kind: 'target', token: target.token })
    expect(await first.completion).toEqual({ status: 'superseded', by: second.token })
    target.unregister()
    expect(await second.completion).toEqual({ status: 'rejected', reason: 'unregistered' })
    const refused = harness.focus.register({
      ...harness.scope,
      id: 'refused-widget',
      area: 'settings',
      textEntry: false,
      focus: () => false,
      isFocused: () => false,
    })
    expect(
      await harness.focus.request({ kind: 'target', token: refused.token }).completion,
    ).toEqual({ status: 'rejected', reason: 'refused' })
  } finally {
    harness.dispose()
  }
})

test('a match request can wait for mount and invalidation rejects it before invocation', async () => {
  const harness = createCommandHarness({ handlers: {} })
  try {
    const request = harness.focus.request({
      kind: 'match',
      matches: (target) => target.widgetId === 'new-widget',
    })
    expect(harness.focus.getSnapshot().requested?.token).toBe(request.token)
    harness.focus.register({
      ...harness.scope,
      id: 'new-widget',
      area: 'settings',
      textEntry: false,
      focus: () => true,
      isFocused: () => true,
    })
    expect(await request.completion).toMatchObject({ status: 'acknowledged' })
    const invalid = harness.focus.request({
      kind: 'match',
      matches: () => true,
      isValid: () => false,
    })
    expect(await invalid.completion).toEqual({ status: 'rejected', reason: 'destination-invalid' })
  } finally {
    harness.dispose()
  }
})

test('target resolution keeps event, origin, owner, exact, last target, and unique precedence', () => {
  const harness = createCommandHarness({ handlers: {} })
  const compatible = (target: { area: string }) => target.area === 'settings'
  try {
    const second = harness.focus.register({
      ...harness.scope,
      id: 'second',
      area: 'settings',
      textEntry: false,
      focus: () => true,
      isFocused: () => true,
    })
    expect(harness.focus.resolveTarget({ compatible, origin: second.token })?.token).toBe(
      second.token,
    )
    expect(
      harness.focus.resolveTarget({
        compatible,
        origin: second.token,
        eventPath: [harness.target.token],
      })?.token,
    ).toBe(harness.target.token)
    expect(
      harness.focus.resolveTarget({ compatible, exact: (target) => target.token === second.token })
        ?.token,
    ).toBe(harness.target.token)
    const overlay = harness.focus.register({
      ...harness.scope,
      id: 'overlay',
      area: 'dialog',
      textEntry: true,
      overlay: true,
      focus: () => true,
      isFocused: () => true,
    })
    harness.focus.activate(overlay.token)
    expect(
      harness.focus.resolveTarget({ compatible, exact: (target) => target.token === second.token })
        ?.token,
    ).toBe(second.token)
    expect(harness.focus.resolveTarget({ compatible })?.token).toBe(harness.target.token)
    harness.target.unregister()
    expect(harness.focus.resolveTarget({ compatible })?.token).toBe(second.token)
    harness.focus.register({
      ...harness.scope,
      id: 'third',
      area: 'settings',
      textEntry: false,
      focus: () => true,
      isFocused: () => true,
    })
    expect(harness.focus.resolveTarget({ compatible })).toBeNull()
  } finally {
    harness.dispose()
  }
})
