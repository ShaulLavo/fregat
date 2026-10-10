export function emptyWorkbenchUrl(base) {
  return new URL('~-/workbench?tabs=-', base).href
}

function inspectTerminal(prompt) {
  function visible(element) {
    if (!element?.checkVisibility({ opacityProperty: true, visibilityProperty: true })) return false
    let opacity = 1
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement)
      opacity *= Number(getComputedStyle(ancestor).opacity)
    if (opacity < 0.05) return false
    const bounds = element.getBoundingClientRect()
    return (
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.right > 0 &&
      bounds.bottom > 0 &&
      bounds.left < innerWidth &&
      bounds.top < innerHeight
    )
  }
  const hosts = Array.from(
    document.querySelectorAll('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu'),
  )
  for (let index = 0; index < hosts.length; index++) {
    const host = hosts[index]
    if (!visible(host)) continue
    const mirror = host.querySelector('[aria-label="Terminal screen"]')
    if (!mirror?.textContent.includes(prompt)) continue
    const canvas = host.querySelector('canvas.ghostty-webgpu-canvas')
    if (!canvas) continue
    const dom = canvas.nextElementSibling
    const row = Array.from(dom?.querySelectorAll('[data-row]') ?? []).find((row) =>
      row.textContent.includes(prompt),
    )
    if (row && visible(row)) {
      const text = Array.from(row.querySelectorAll('span'))
        .filter(visible)
        .map((span) => span.textContent)
        .join('')
      if (text.includes(prompt))
        return { count: hosts.filter(visible).length, index, surface: 'dom' }
    }
    if (!visible(canvas)) continue
    const rows = Array.from(mirror.children)
    const rowIndex = rows.findIndex((row) => row.textContent.includes(prompt))
    return {
      count: hosts.filter(visible).length,
      index,
      surface: 'canvas',
      row: Math.max(0, rowIndex),
      rows: Math.max(1, rows.length),
    }
  }
  return null
}

async function promptPixels({ png, row, rows, characters }) {
  const bytes = Uint8Array.from(atob(png), (character) => character.charCodeAt(0))
  const blob = new Blob([bytes], { type: 'image/png' })
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  context.drawImage(bitmap, 0, 0)
  bitmap.close()
  const height = Math.min(40, Math.floor(canvas.height / rows))
  const width = Math.min(canvas.width, characters * height)
  if (height < 1 || width < 1) return false
  const pixels = context.getImageData(0, row * height, width, height).data
  const frequencies = new Map()
  const colors = []
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const color = `${pixels[offset]},${pixels[offset + 1]},${pixels[offset + 2]}`
    colors.push(color)
    frequencies.set(color, (frequencies.get(color) ?? 0) + 1)
  }
  const background = Array.from(frequencies).sort((a, b) => b[1] - a[1])[0]?.[0]
  const columns = new Set()
  for (let index = 0; index < colors.length; index++) {
    if (colors[index] !== background) columns.add(index % width)
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
    if (rendered.surface === 'dom') return { count: rendered.count, promptRendered: true }
    const surface = page
      .locator('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu')
      .nth(rendered.index)
      .locator('canvas.ghostty-webgpu-canvas')
    const png = await surface.screenshot({ timeout: Math.max(1, deadline - Date.now()) })
    const painted = await page.evaluate(promptPixels, {
      png: png.toString('base64'),
      row: rendered.row,
      rows: rendered.rows,
      characters: prompt.length,
    })
    if (painted && (await page.evaluate(inspectTerminal, prompt)))
      return { count: rendered.count, promptRendered: true }
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
