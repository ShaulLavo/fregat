export function emptyWorkbenchUrl(base) {
  return new URL('~-/workbench?tabs=-', base).href
}

function inspectTerminal(prompt) {
  const hosts = Array.from(
    document.querySelectorAll('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu'),
  )
  for (let index = 0; index < hosts.length; index++) {
    const host = hosts[index]
    const mirror = host.querySelector('[aria-label="Terminal screen"]')
    if (!mirror?.textContent.includes(prompt)) continue
    const canvas = host.querySelector('canvas.ghostty-webgpu-canvas')
    if (!canvas) continue
    const domRows = Array.from(canvas.nextElementSibling?.querySelectorAll('[data-row]') ?? [])
    const domRow = domRows.findIndex((row) => row.textContent.includes(prompt))
    if (domRow >= 0)
      return {
        count: hosts.length,
        index,
        selector: '[data-row]',
        surfaceIndex: domRow,
        row: 0,
        rows: 1,
      }
    const rows = Array.from(mirror.children)
    return {
      count: hosts.length,
      index,
      selector: 'canvas.ghostty-webgpu-canvas',
      surfaceIndex: 0,
      row: Math.max(
        0,
        rows.findIndex((row) => row.textContent.includes(prompt)),
      ),
      rows: Math.max(1, rows.length),
    }
  }
  return null
}

async function promptPixels({ png, bounds, row, rows, characters }) {
  const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const rowHeight = bounds.height / rows
  const top = bounds.y + row * rowHeight
  const x = Math.max(0, Math.floor(bounds.x))
  const y = Math.max(0, Math.floor(top))
  const width = Math.floor(
    Math.min(canvas.width, bounds.x + Math.min(bounds.width, characters * rowHeight)) - x,
  )
  const height = Math.floor(Math.min(canvas.height, top + Math.min(40, rowHeight)) - y)
  if (height < 1 || width < 1) return false
  const pixels = context.getImageData(x, y, width, height).data
  const frequencies = new Map()
  const colors = []
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const color = `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`
    colors.push(color)
    frequencies.set(color, (frequencies.get(color) ?? 0) + 1)
  }
  const background = Array.from(frequencies).sort((a, b) => b[1] - a[1])[0]?.[0]
  const base = background.split(',').map(Number)
  const columns = new Set()
  for (let index = 0; index < colors.length; index++) {
    const color = colors[index].split(',').map(Number)
    const contrast = Math.max(...color.map((value, channel) => Math.abs(value - base[channel])))
    if (contrast >= 32) columns.add(index % width)
  }
  // An empty canvas or the cursor alone cannot account for a prompt's glyph columns.
  return columns.size >= characters * 2
}

export async function waitForTerminalPrompt(page, prompt, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const handle = await page.waitForFunction(inspectTerminal, prompt, {
      timeout: Math.max(1, deadline - Date.now()),
    })
    let rendered
    try {
      rendered = await handle.jsonValue()
    } finally {
      await handle.dispose()
    }
    const surface = page
      .locator('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu')
      .nth(rendered.index)
      .locator(rendered.selector)
      .nth(rendered.surfaceIndex)
    const bounds = await surface.boundingBox({ timeout: Math.max(1, deadline - Date.now()) })
    if (bounds) {
      // Viewport capture proves presented pixels without scrolling a hidden surface into view.
      const png = await page.screenshot({ timeout: Math.max(1, deadline - Date.now()) })
      const painted = await page.evaluate(promptPixels, {
        png: png.toString('base64'),
        bounds,
        row: rendered.row,
        rows: rendered.rows,
        characters: prompt.length,
      })
      if (painted) return { count: rendered.count, promptRendered: true }
    }
    await page.waitForTimeout(Math.min(50, Math.max(1, deadline - Date.now())))
  }
  throw new DOMException('Timeout waiting for visible shell prompt pixels.', 'TimeoutError')
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
  if (backend?.server?.commit !== commit)
    failures.push('terminal check: isolated backend commit differs from deployed client')
  for (const [name, release] of [
    ['deployed', deployed],
    ['isolated', backend],
  ]) {
    if (release?.server?.commit !== commit)
      failures.push(`terminal check: ${name} server commit differs from deployed client`)
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
