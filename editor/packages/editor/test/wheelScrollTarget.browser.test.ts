import { afterEach, expect, test } from 'vitest'
import { FixedRowVirtualizer } from '../src/virtualization/fixedRowVirtualizer'
import { registerWheelScrollTarget } from '../src/virtualization/wheelScrollTarget'

const fixtures: { dispose(): void }[] = []

afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.dispose()
})

function createFixture(maxScrollHeight = 16_000_000) {
  const host = document.createElement('div')
  host.style.cssText = 'position:relative;width:420px;height:180px;margin:20px'
  const element = document.createElement('div')
  element.style.cssText = 'width:100%;height:100%;overflow:scroll;scroll-behavior:smooth'
  const spacer = document.createElement('div')
  spacer.style.cssText = 'width:2000px;height:20000px'
  element.append(spacer)
  const overlay = document.createElement('div')
  overlay.style.cssText = 'position:absolute;right:20px;top:0;width:60px;height:100%'
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'width:60px;height:100%'
  const slider = document.createElement('div')
  slider.style.cssText = 'position:absolute;top:0;left:0;width:60px;height:25px'
  overlay.append(canvas, slider)
  host.append(element, overlay)
  document.body.append(host)
  const nativeTop = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!.get!
  const nativeHeight = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollHeight')!.get!
  const updates: number[] = []
  const virtualizer = new FixedRowVirtualizer({ count: 1000, rowHeight: 20, maxScrollHeight })
  virtualizer.attachScrollElement(element, (snapshot) => {
    spacer.style.height = `${snapshot.nativeScrollHeight}px`
    updates.push(snapshot.scrollTop)
  })
  const registration = registerWheelScrollTarget({ scrollElement: element }, overlay)
  const fixture = {
    host,
    element,
    overlay,
    canvas,
    slider,
    virtualizer,
    registration,
    updates,
    nativeTop: () => nativeTop.call(element) as number,
    nativeHeight: () => nativeHeight.call(element) as number,
    dispose: () => {
      registration.dispose()
      virtualizer.dispose()
      host.remove()
    },
  }
  fixtures.push(fixture)
  return fixture
}

async function settle(): Promise<void> {
  for (let frame = 0; frame < 4; frame += 1) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()))
  }
}

function wheel(target: EventTarget, init: WheelEventInit): WheelEvent {
  const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, ...init })
  target.dispatchEvent(event)
  return event
}

test('consumes a native scroll before the logical scrollTop cache is synchronized', async () => {
  const fixture = createFixture()
  await settle()
  fixture.updates.length = 0
  const event = wheel(fixture.canvas, { deltaY: 120 })
  expect(event.defaultPrevented).toBe(true)
  expect(fixture.nativeTop()).toBe(120)
  expect(fixture.element.scrollTop).toBe(0)
  expect(fixture.updates.length).toBe(0)
  await settle()
  expect(fixture.virtualizer.getViewportSnapshot().scrollTop).toBe(120)
  expect(fixture.updates.length).toBeGreaterThan(0)
})

test('uses the existing native-to-logical conversion for a capped document', async () => {
  const fixture = createFixture(1000)
  await settle()
  const before = fixture.virtualizer.getViewportSnapshot()
  const ratio =
    (before.scrollHeight - before.viewportHeight) /
    (before.nativeScrollHeight - before.viewportHeight)
  expect(ratio).toBeGreaterThan(1)
  const event = wheel(fixture.slider, { deltaY: 100 })
  expect(event.defaultPrevented).toBe(true)
  expect(fixture.nativeTop()).toBe(100)
  expect(fixture.element.scrollTop).toBe(0)
  await settle()
  expect(fixture.element.scrollTop).toBeCloseTo(100 * ratio, 5)
})

test('accumulates wheel input before the next viewport update without reading cached offsets', async () => {
  const fixture = createFixture()
  await settle()
  for (let step = 0; step < 3; step += 1) {
    expect(wheel(fixture.overlay, { deltaY: 100 }).defaultPrevented).toBe(true)
  }
  expect(fixture.nativeTop()).toBe(300)
  expect(fixture.element.scrollTop).toBe(0)
  await settle()
  expect(fixture.element.scrollTop).toBe(300)
})

test('retains fractional deltas on both axes, including events with no rounded movement', async () => {
  const fixture = createFixture()
  await settle()
  for (let step = 0; step < 8; step += 1) {
    expect(wheel(fixture.canvas, { deltaX: 0.25, deltaY: 0.25 }).defaultPrevented).toBe(true)
  }
  expect(fixture.nativeTop()).toBe(2)
  expect(fixture.element.scrollLeft).toBe(2)
})

test('drops fractional residue when another input moves the native scroller', async () => {
  const fixture = createFixture()
  await settle()
  wheel(fixture.overlay, { deltaY: 0.25 })
  fixture.element.scrollBy({ top: 100, behavior: 'instant' })
  wheel(fixture.overlay, { deltaY: 0.25 })
  expect(fixture.nativeTop()).toBe(100)
})

test('normalizes line deltas with the current editor row height', async () => {
  const fixture = createFixture()
  await settle()
  fixture.virtualizer.updateOptions({ rowHeight: 30 })
  wheel(fixture.overlay, { deltaMode: 1, deltaX: 2, deltaY: 3 })
  expect(fixture.element.scrollLeft).toBe(60)
  expect(fixture.nativeTop()).toBe(90)
})

test('normalizes page deltas against each native viewport axis', async () => {
  const fixture = createFixture()
  await settle()
  wheel(fixture.overlay, { deltaMode: 2, deltaX: 1, deltaY: 1 })
  expect(fixture.element.scrollLeft).toBe(fixture.element.clientWidth)
  expect(fixture.nativeTop()).toBe(fixture.element.clientHeight)
})

test('maps Shift-page input to horizontal width before scaling', async () => {
  const fixture = createFixture()
  await settle()
  wheel(fixture.overlay, { deltaMode: 2, deltaY: 1, shiftKey: true })
  expect(fixture.element.scrollLeft).toBe(fixture.element.clientWidth)
  expect(fixture.nativeTop()).toBe(0)
})

test('does not remap an already horizontal or diagonal Shift gesture', async () => {
  const fixture = createFixture()
  await settle()
  wheel(fixture.overlay, { deltaX: 17, deltaY: 19, shiftKey: true })
  expect(fixture.element.scrollLeft).toBe(17)
  expect(fixture.nativeTop()).toBe(19)
})

test('leaves zoom, cancelled, non-cancelable, and zero input alone', async () => {
  const fixture = createFixture()
  await settle()
  expect(wheel(fixture.overlay, { deltaY: 100, ctrlKey: true }).defaultPrevented).toBe(false)
  expect(wheel(fixture.overlay, { deltaY: 100, cancelable: false }).defaultPrevented).toBe(false)
  expect(wheel(fixture.overlay, {}).defaultPrevented).toBe(false)
  const cancelled = new WheelEvent('wheel', { deltaY: 100, bubbles: true, cancelable: true })
  cancelled.preventDefault()
  fixture.overlay.dispatchEvent(cancelled)
  expect(fixture.nativeTop()).toBe(0)
})

test('chains at native boundaries and immediately handles a direction reversal', async () => {
  const fixture = createFixture(1000)
  await settle()
  expect(wheel(fixture.overlay, { deltaY: -120 }).defaultPrevented).toBe(false)
  fixture.element.scrollTo({ top: fixture.nativeHeight(), behavior: 'instant' })
  expect(wheel(fixture.overlay, { deltaY: 120 }).defaultPrevented).toBe(false)
  expect(wheel(fixture.overlay, { deltaY: -120 }).defaultPrevented).toBe(true)
  expect(fixture.nativeTop()).toBe(fixture.nativeHeight() - fixture.element.clientHeight - 120)
})

test('honors overscroll containment at an editor boundary', async () => {
  const fixture = createFixture()
  await settle()
  fixture.element.style.overscrollBehaviorY = 'contain'
  expect(wheel(fixture.overlay, { deltaY: -120 }).defaultPrevented).toBe(true)
  expect(fixture.nativeTop()).toBe(0)
})

test('does not programmatically wheel-scroll an overflow-hidden axis', async () => {
  const fixture = createFixture()
  await settle()
  fixture.element.scrollTo({ top: 100, behavior: 'instant' })
  fixture.element.style.overflowY = 'hidden'
  expect(wheel(fixture.overlay, { deltaY: -20 }).defaultPrevented).toBe(false)
  expect(fixture.nativeTop()).toBe(100)
})

test('respects provisional paint without consulting a plugin snapshot', async () => {
  const fixture = createFixture()
  await settle()
  fixture.element.style.scrollBehavior = 'auto'
  fixture.virtualizer.setProvisionalScrollGeometry({ scrollTop: 25, scrollHeight: 2000 })
  expect(wheel(fixture.overlay, { deltaY: 120 }).defaultPrevented).toBe(false)
  expect(fixture.nativeTop()).toBe(25)
  fixture.virtualizer.setProvisionalScrollGeometry(null)
  expect(wheel(fixture.overlay, { deltaY: 120 }).defaultPrevented).toBe(true)
  expect(fixture.nativeTop()).toBe(120)
})

test('keeps horizontal delegation but not vertical scrolling in static mode', async () => {
  const fixture = createFixture()
  await settle()
  fixture.virtualizer.updateOptions({ scrollMode: 'static' })
  fixture.element.style.overflowY = 'clip'
  expect(wheel(fixture.overlay, { deltaX: 60 }).defaultPrevented).toBe(true)
  expect(fixture.element.scrollLeft).toBe(60)
  expect(wheel(fixture.overlay, { deltaY: 60 }).defaultPrevented).toBe(false)
  expect(fixture.nativeTop()).toBe(0)
})

test('removes an overlay registration on disposal', async () => {
  const fixture = createFixture()
  await settle()
  fixture.registration.dispose()
  expect(wheel(fixture.overlay, { deltaY: 120 }).defaultPrevented).toBe(false)
  expect(fixture.nativeTop()).toBe(0)
})

test('stops delegation when the scroll owner detaches', async () => {
  const fixture = createFixture()
  await settle()
  fixture.virtualizer.detachScrollElement()
  expect(wheel(fixture.overlay, { deltaY: 120 }).defaultPrevented).toBe(false)
  expect(fixture.nativeTop()).toBe(0)
})

test('isolates native scroll state between editors', async () => {
  const first = createFixture()
  const second = createFixture()
  await settle()
  wheel(first.overlay, { deltaY: 100 })
  expect(first.nativeTop()).toBe(100)
  expect(second.nativeTop()).toBe(0)
  wheel(second.overlay, { deltaY: 200 })
  expect(first.nativeTop()).toBe(100)
  expect(second.nativeTop()).toBe(200)
})

test('shares fractional accumulation between overlays of the same editor', async () => {
  const fixture = createFixture()
  const second = document.createElement('div')
  fixture.host.append(second)
  const registration = registerWheelScrollTarget({ scrollElement: fixture.element }, second)
  try {
    await settle()
    for (let step = 0; step < 8; step += 1) {
      wheel(step % 2 === 0 ? fixture.overlay : second, { deltaY: 0.25 })
    }
    expect(fixture.nativeTop()).toBe(2)
  } finally {
    registration.dispose()
  }
})

test('leaves editor wheel events native and rejects native descendants or shared ancestors', async () => {
  const fixture = createFixture()
  await settle()
  expect(wheel(fixture.element, { deltaY: 120 }).defaultPrevented).toBe(false)
  expect(fixture.nativeTop()).toBe(0)
  const context = { scrollElement: fixture.element }
  expect(() => registerWheelScrollTarget(context, fixture.element)).toThrow()
  expect(() =>
    registerWheelScrollTarget(context, fixture.element.firstElementChild as HTMLElement),
  ).toThrow()
  expect(() => registerWheelScrollTarget(context, fixture.host)).toThrow()
})
