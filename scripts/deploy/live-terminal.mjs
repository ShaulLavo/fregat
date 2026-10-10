export function emptyWorkbenchUrl(base) {
  return new URL('~-/workbench?tabs=-', base).href
}

function inspectTerminal({ prompt, index, suffix, text }) {
  const hosts = Array.from(
    document.querySelectorAll('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu'),
  )
  for (let candidate = 0; candidate < hosts.length; candidate++) {
    if (index !== undefined && candidate !== index) continue
    const host = hosts[candidate]
    const mirror = host.querySelector('[aria-label="Terminal screen"]')
    const rows = Array.from(mirror?.children ?? [])
    const row = rows.findIndex((element) => element.textContent.includes(prompt))
    if (row < 0) continue
    const value = rows[row].textContent
    if (suffix && !value.endsWith(suffix)) continue
    if (text !== undefined && value !== text) continue
    const canvas = host.querySelector('canvas.ghostty-webgpu-canvas')
    const input = host.querySelector('textarea[aria-label="Terminal input"]')
    if (!canvas || !input) continue
    const surface = canvas.getBoundingClientRect()
    const style = getComputedStyle(canvas)
    const left = parseFloat(style.paddingLeft) || 0
    const top = parseFloat(style.paddingTop) || 0
    const bounds = {
      x: surface.x + left,
      y: surface.y + top,
      width: surface.width - left - (parseFloat(style.paddingRight) || 0),
      height: surface.height - top - (parseFloat(style.paddingBottom) || 0),
    }
    const x = Math.max(0, bounds.x)
    const y = Math.max(0, bounds.y)
    const clip = {
      x,
      y,
      width: Math.min(innerWidth, bounds.x + bounds.width) - x,
      height: Math.min(innerHeight, bounds.y + bounds.height) - y,
    }
    if (clip.width <= 0 || clip.height <= 0) continue
    const caret = input.getBoundingClientRect()
    return {
      count: hosts.length,
      index: candidate,
      row,
      text: value,
      bounds,
      clip,
      rowHeight: bounds.height / rows.length,
      caret: { x: caret.x, y: caret.y },
    }
  }
  return null
}

// Letter strokes occupy part of a cell; full-cell fills cannot prove glyph paint.
const MIN_GLYPH_CHANGED_FRACTION = 0.03
const MAX_GLYPH_CHANGED_FRACTION = 0.7
const GLYPH_CHANNEL_DELTA = 16
// Allow small capture noise while requiring each restored cell to return to its baseline.
const RESTORE_CHANNEL_TOLERANCE = 8
const MAX_RESTORE_CHANGED_FRACTION = 0.01

async function changedInputPixels({
  before,
  after,
  first,
  second,
  restored,
  characters,
  leadingCells,
  thresholds,
}) {
  for (const current of [second, restored].filter(Boolean)) {
    if (first.row !== current.row || Math.abs(first.caret.y - current.caret.y) > 1) return false
    if (Object.keys(first.bounds).some((key) => first.bounds[key] !== current.bounds[key]))
      return false
  }
  if (restored && Math.abs(first.caret.x - restored.caret.x) > 1) return false
  const cellWidth = (second.caret.x - first.caret.x) / (characters + leadingCells)
  if (!(cellWidth > 0) || !(first.rowHeight > 0)) return false
  if (Math.abs(first.caret.y - first.bounds.y - first.row * first.rowHeight) > 1) return false
  const left = first.caret.x - first.clip.x
  const top = first.caret.y - first.clip.y
  const cells = characters + leadingCells + 1
  const right = left + cellWidth * cells
  const bottom = top + first.rowHeight
  if (left < 0 || top < 0 || right > first.clip.width || bottom > first.clip.height) return false
  const decode = async (png) => {
    const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: 'image/png' }))
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
    const context = canvas.getContext('2d')
    context.drawImage(bitmap, 0, 0)
    bitmap.close()
    return {
      width: canvas.width,
      height: canvas.height,
      pixels: context.getImageData(0, 0, canvas.width, canvas.height).data,
    }
  }
  const [baseline, compared] = await Promise.all([decode(before), decode(after)])
  if (baseline.width !== compared.width || baseline.height !== compared.height) return false
  if (right > baseline.width || bottom > baseline.height) return false
  const firstCell = restored ? 0 : leadingCells
  const lastCell = restored ? cells : leadingCells + characters
  const channelDelta = restored
    ? thresholds.restoreChannelTolerance + 1
    : thresholds.glyphChannelDelta
  for (let cell = firstCell; cell < lastCell; cell++) {
    let changed = 0
    let area = 0
    const columns = new Set()
    for (let y = Math.floor(top); y < Math.ceil(bottom); y++) {
      for (
        let x = Math.floor(left + cell * cellWidth);
        x < Math.ceil(left + (cell + 1) * cellWidth);
        x++
      ) {
        area++
        const offset = (y * baseline.width + x) * 4
        const difference = Math.max(
          Math.abs(baseline.pixels[offset] - compared.pixels[offset]),
          Math.abs(baseline.pixels[offset + 1] - compared.pixels[offset + 1]),
          Math.abs(baseline.pixels[offset + 2] - compared.pixels[offset + 2]),
        )
        if (difference < channelDelta) continue
        changed++
        columns.add(x)
      }
    }
    const fraction = changed / area
    if (restored) {
      if (fraction > thresholds.maxRestoreChangedFraction) return false
      continue
    }
    if (
      fraction < thresholds.minGlyphChangedFraction ||
      fraction > thresholds.maxGlyphChangedFraction ||
      changed < 6 ||
      columns.size < 2
    )
      return false
  }
  return true
}

function focusInput(element) {
  element.focus({ preventScroll: true })
  return element.ownerDocument.activeElement === element
}

async function eraseInput(page, input, options) {
  if (!(await input.evaluate(focusInput, undefined, { timeout: 5_000 })))
    throw new DOMException('Timeout restoring the terminal input focus.', 'TimeoutError')
  await page.keyboard.press('Control+u')
  const cleared = await page.waitForFunction(inspectTerminal, options, { timeout: 5_000 })
  try {
    return await cleared.jsonValue()
  } finally {
    await cleared.dispose()
  }
}

async function restoreInput(page, input, options, proof) {
  const restored = await eraseInput(page, input, options)
  const after = await page.screenshot({ clip: proof.first.clip, scale: 'css', timeout: 5_000 })
  if (!proof.second) return
  const matched = await page.evaluate(changedInputPixels, {
    ...proof,
    restored,
    after: after.toString('base64'),
  })
  if (!matched)
    throw new DOMException('Timeout restoring the terminal input pixels.', 'TimeoutError')
}

export async function waitForTerminalPrompt(page, prompt, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  const remaining = () => Math.max(1, deadline - Date.now())
  const read = async (options) => {
    const handle = await page.waitForFunction(inspectTerminal, options, { timeout: remaining() })
    try {
      return await handle.jsonValue()
    } finally {
      await handle.dispose()
    }
  }
  const first = await read({ prompt })
  const input = page
    .locator('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu')
    .nth(first.index)
    .getByRole('textbox', { name: 'Terminal input', exact: true })
  if (!(await input.evaluate(focusInput, undefined, { timeout: remaining() })))
    throw new DOMException('Timeout focusing the terminal input.', 'TimeoutError')
  // Clip a viewport capture without scrolling an offscreen terminal into view.
  const before = await page.screenshot({ clip: first.clip, scale: 'css', timeout: remaining() })
  const marker = 'xyz'
  // The spacer keeps the original block cursor out of the three letter cells.
  const typed = ` ${marker}`
  const proof = {
    before: before.toString('base64'),
    first,
    second: undefined,
    characters: marker.length,
    leadingCells: 1,
    thresholds: {
      minGlyphChangedFraction: MIN_GLYPH_CHANGED_FRACTION,
      maxGlyphChangedFraction: MAX_GLYPH_CHANGED_FRACTION,
      glyphChannelDelta: GLYPH_CHANNEL_DELTA,
      restoreChannelTolerance: RESTORE_CHANNEL_TOLERANCE,
      maxRestoreChangedFraction: MAX_RESTORE_CHANGED_FRACTION,
    },
  }
  try {
    await page.keyboard.type(typed)
    const options = { prompt, index: first.index, suffix: typed }
    await read(options)
    while (Date.now() < deadline) {
      const second = await page.evaluate(inspectTerminal, options)
      if (!second) break
      const after = await page.screenshot({ clip: first.clip, scale: 'css', timeout: remaining() })
      const painted = await page.evaluate(changedInputPixels, {
        ...proof,
        after: after.toString('base64'),
        second,
      })
      if (painted) {
        proof.second = second
        return { count: first.count, promptRendered: true }
      }
      await page.waitForTimeout(Math.min(50, remaining()))
    }
    throw new DOMException('Timeout waiting for rendered terminal input pixels.', 'TimeoutError')
  } finally {
    await restoreInput(page, input, { prompt, index: first.index, text: first.text }, proof)
  }
}

export function terminalFailures(terminal) {
  const failures = []
  if (!(terminal.count > 0)) failures.push('terminal check: no terminal mounted')
  if (!terminal.promptRendered) failures.push('terminal check: shell prompt did not render')
  if (!['webgpu', 'webgl2', 'canvas2d', 'dom'].includes(terminal.rendererBackend))
    failures.push('terminal check: renderer backend was not selected')
  if (!terminal.closed) failures.push('terminal check: terminal cleanup did not complete')
  return failures
}

export function terminalReleaseFailures(deployed, backend, protocolVersion) {
  const failures = []
  const commit = deployed?.commit
  if (typeof commit !== 'string' || !/^[a-f0-9]{40}$/.test(commit))
    failures.push('terminal check: deployed client commit is missing')
  // The isolated backend runs from the installed release; a web-only install keeps the running
  // server on its older commit, so the deployed server's commit isn't compared.
  if (backend?.server?.commit !== commit)
    failures.push('terminal check: isolated backend commit differs from deployed client')
  for (const [name, release] of [
    ['deployed', deployed],
    ['isolated', backend],
  ]) {
    if (release?.dirtyFiles !== 0 || release?.server?.dirtyFiles !== 0)
      failures.push(`terminal check: ${name} backend artifacts have uncommitted changes`)
    const host = release?.terminalHostProbe
    if (
      host?.type !== 'hello' ||
      host.version !== protocolVersion ||
      !Number.isInteger(host.pid) ||
      !(host.pid > 0)
    )
      failures.push(`terminal check: ${name} fresh terminal host reply is missing or invalid`)
  }
  return failures
}

export function foreignTerminalRequests(requests, origins) {
  return [...new Set(requests)].filter((address) => {
    const url = new URL(address)
    if (url.protocol === 'ws:') url.protocol = 'http:'
    if (url.protocol === 'wss:') url.protocol = 'https:'
    return ['http:', 'https:'].includes(url.protocol) && !origins.includes(url.origin)
  })
}
