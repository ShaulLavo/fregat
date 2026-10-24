import { mount } from 'ACTOR'
import { fixture } from 'FIXTURE'
import { outputProof } from './output-proof.mjs'
import { verifyDisposedRetention } from './retention.mjs'

let preparedText
const host = document.querySelector('#editor')
let editor
const events = []
new PerformanceObserver((list) =>
  events.push(
    ...list.getEntries().map((event) => ({
      name: event.name,
      duration: event.duration,
      startTime: event.startTime,
      processingStart: event.processingStart,
      processingEnd: event.processingEnd,
      interactionId: event.interactionId,
    })),
  ),
).observe({ type: 'event', buffered: true, durationThreshold: 16 })

const frame = () => new Promise((resolve) => requestAnimationFrame(resolve))
const painted = async () => {
  await frame()
  await frame()
}

const geometry = () => {
  const walker = document.createTreeWalker(host, NodeFilter.SHOW_TEXT)
  let textNode
  let visibleStyle
  while ((textNode = walker.nextNode())) {
    if (!textNode.textContent.trim() || !textNode.parentElement.getClientRects().length) continue
    const box = textNode.parentElement.getBoundingClientRect()
    if (box.width < 10 || box.height < 10 || box.right <= 0 || box.bottom <= 0) continue
    const style = getComputedStyle(textNode.parentElement)
    visibleStyle = {
      fontFamily: style.fontFamily,
      fontSize: style.fontSize,
      lineHeight: style.lineHeight,
    }
    break
  }
  const viewport = editor.viewport()
  return {
    width: host.clientWidth,
    height: host.clientHeight,
    visibleStyle,
    scrollViewport: { width: viewport.clientWidth, height: viewport.clientHeight },
    renderedRows: editor.rowCount(),
  }
}

const waitFor = async (predicate) => {
  const start = performance.now()
  while (!predicate()) {
    if (performance.now() - start > 60000)
      throw new RangeError('Lifecycle control exceeded 60 seconds')
    await frame()
  }
}

const settleMutation = async (mutate) => {
  const probe = globalThis.__compareOpenProbe
  const before = probe.outputCount
  mutate()
  await waitFor(() => {
    const result = probe.outputs.at(-1)
    const root = result?.statistics?.__compareCoverage?.find((layer) => layer.kind === 'root')
    return (
      probe.outputCount > before &&
      !result.missingLanguages?.length &&
      result.analysis?.kind !== 'partial' &&
      result.analysis?.kind !== 'cancelled' &&
      root?.start === 0 &&
      root.end === result.statistics.rangeEnd
    )
  })
  await painted()
  return outputProof()
}

window.bench = {
  geometry,
  prepare(mib) {
    preparedText = fixture(mib, new URLSearchParams(location.search).get('corpus') ?? 'repeated')
  },
  async warm() {
    this.prepare(1)
    await this.open()
    this.warmEditor = editor
    editor = undefined
    host.replaceChildren()
    const probe = globalThis.__compareOpenProbe
    probe.warmup = probe.messages
      .filter((message) => message.resultMode === 'full')
      .map((message) => ({
        worker: message.worker,
        documentId: message.documentId,
        runtimeSessionId: message.runtimeSessionId,
      }))
    globalThis.__compareOpenProbe.diagnostics.length = 0
    globalThis.__compareOpenProbe.messages.length = 0
    globalThis.__compareOpenProbe.outputs.length = 0
    globalThis.__compareOpenProbe.proof = undefined
    performance.clearMarks()
  },
  async open() {
    const text = preparedText
    preparedText = undefined
    const start = performance.now()
    performance.mark('compare-open-start')
    editor = mount(host, text, HIGHLIGHTED)
    performance.mark('compare-open-mounted')
    if (new URLSearchParams(location.search).get('fullDocument') === 'true')
      await editor.fullHighlight?.()
    await painted()
    const firstFrameMs = performance.now() - start
    performance.mark('compare-open-first-frame')
    if (HIGHLIGHTED) {
      while (!editor.highlighted()) {
        if (performance.now() - start > 30000)
          throw new RangeError('Highlighting did not become visible in 30 seconds')
        await frame()
      }
    }
    performance.mark('compare-open-visible')
    await painted()
    const highlightedFrameMs = performance.now() - start
    performance.mark('compare-open-settled')
    return {
      firstFrameMs,
      highlightedFrameMs,
      geometry: geometry(),
      facts: editor.facts(),
      length: editor.length(),
    }
  },
  async lifecycle(mib) {
    const probe = globalThis.__compareOpenProbe
    const before = await outputProof()
    const snapshot = editor.snapshot()
    const prefix = snapshot.readRange(0, 32)
    const edits = []
    const retained = [snapshot]
    for (const character of ['x', 'y', prefix[0]]) {
      edits.push(await settleMutation(() => editor.edit(0, 1, character)))
      retained.push(editor.snapshot())
    }
    if (snapshot.readRange(0, 32) !== prefix)
      throw new RangeError('Retained text snapshot changed after editing')
    const afterEdits = await probe.inspectRetention()
    const original = await outputProof()
    if (
      before.tokenSha256 !== original.tokenSha256 ||
      before.structuralSha256 !== original.structuralSha256
    )
      throw new RangeError('Round-trip edits changed complete syntax output')
    const extras = []
    const dense = fixture(mib, 'dense-injected')
    for (let index = 0; index < 2; index++) {
      const element = document.createElement('div')
      element.style.cssText =
        'position:absolute;left:2000px;top:0;width:640px;height:480px;display:flex;flex-direction:column'
      document.body.append(element)
      let extra
      const proof = await settleMutation(() => {
        extra = mount(element, dense, true)
      })
      extras.push({ extra, element, proof })
    }
    const multiple = await probe.inspectRetention()
    const element = document.createElement('div')
    element.style.cssText =
      'position:absolute;left:3000px;top:0;width:640px;height:480px;display:flex;flex-direction:column'
    document.body.append(element)
    const sentBefore = probe.messages.length
    const cancelled = mount(element, dense, true)
    await waitFor(() =>
      probe.messages
        .slice(sentBefore)
        .some((message) => message.direction === 'sent' && message.resultMode === 'full'),
    )
    const cancelledRequest = probe.messages
      .slice(sentBefore)
      .find((message) => message.direction === 'sent' && message.resultMode === 'full')
    const replacement = await settleMutation(() => cancelled.reset(fixture(mib, 'repeated')))
    const afterReplacement = await probe.inspectRetention()
    const response = probe.messages.find(
      (message) =>
        message.direction === 'received' &&
        message.worker === cancelledRequest.worker &&
        message.id === cancelledRequest.id,
    )
    if (!response || (response.ok && response.analysis?.kind !== 'cancelled'))
      throw new RangeError('Replacement control did not cancel its dispatched parse')
    cancelled.dispose()
    element.remove()
    for (const { extra, element } of extras) {
      extra.dispose()
      element.remove()
    }
    await painted()
    const afterDisposal = await probe.inspectRetention()
    verifyDisposedRetention(afterEdits, multiple, afterDisposal)
    return {
      edits,
      afterEdits,
      retainedTextSnapshots: retained.length,
      multiple,
      denseDocuments: extras.map(({ proof }) => proof),
      cancellation: { request: cancelledRequest, response, replacement, afterReplacement },
      afterDisposal,
    }
  },
  async position(where) {
    const offset = where === 'end' ? editor.length() : Math.floor(editor.length() / 2)
    editor.position(offset)
    await painted()
    return offset
  },
  arm(letter, count) {
    const before = editor.length()
    const eventStart = events.length
    let started
    let listenerStarted
    let trusted
    let resolve
    const result = new Promise((done) => {
      resolve = done
    })
    const keydown = (event) => {
      if (event.key !== letter) return
      trusted = event.isTrusted
      started = event.timeStamp
      listenerStarted = performance.now()
      const delay = Number(new URLSearchParams(location.search).get('delay') ?? 0)
      while (performance.now() - listenerStarted < delay) {}
      host.removeEventListener('keydown', keydown, true)
    }
    host.addEventListener('keydown', keydown, true)
    const observer = new MutationObserver(async () => {
      if (started === undefined || editor.length() !== before + 1) return
      observer.disconnect()
      const mutationMs = performance.now() - started
      await painted()
      resolve({
        mutationMs,
        trusted,
        listenerLagMs: listenerStarted - started,
        inputToFrameMs: performance.now() - started,
        length: editor.length(),
        rendered: host.textContent.includes(letter.repeat(count)),
        eventTiming: events
          .slice(eventStart)
          .filter((event) => event.name === 'keydown' && Math.abs(event.startTime - started) < 1),
      })
    })
    observer.observe(host, { subtree: true, childList: true, characterData: true })
    this.inputResult = result
  },
  async scroll(frames) {
    editor.scroll(0)
    await painted()
    const timestamps = []
    performance.mark('compare-scroll-start')
    for (let index = 0; index < frames; index++) {
      timestamps.push(await frame())
      performance.mark('compare-scroll-frame')
      editor.scroll((index + 1) * 200)
    }
    timestamps.push(await frame())
    performance.mark('compare-scroll-frame')
    performance.mark('compare-scroll-end')
    await painted()
    return {
      intervalsMs: timestamps.slice(1).map((value, i) => value - timestamps[i]),
      top: editor.scrollTop(),
    }
  },
  assertTyped(offset, count, letter) {
    return editor.slice(offset, offset + count) === letter.repeat(count)
  },
  facts: () => editor?.facts(),
  textLength: () => editor.length(),
}
