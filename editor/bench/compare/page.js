import { mount } from 'ACTOR'
import { fixture } from 'FIXTURE'

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

window.bench = {
  geometry,
  prepare(mib) {
    preparedText = fixture(mib)
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
