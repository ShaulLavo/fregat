export function emptyWorkbenchUrl(base) {
  return new URL('~-/workbench?tabs=-', base).href
}

function inspectTerminal(prompt) {
  const hosts = Array.from(
    document.querySelectorAll('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu'),
  ).filter((host) => {
    const bounds = host.getBoundingClientRect()
    return (
      host.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
      bounds.width > 0 &&
      bounds.height > 0 &&
      bounds.right > 0 &&
      bounds.bottom > 0 &&
      bounds.left < innerWidth &&
      bounds.top < innerHeight
    )
  })
  const promptRendered = hosts.some((host) =>
    host.querySelector('[aria-label="Terminal screen"]')?.textContent.includes(prompt),
  )
  return promptRendered ? { count: hosts.length, promptRendered } : null
}

export async function waitForTerminalPrompt(page, prompt, timeoutMs = 30_000) {
  const handle = await page.waitForFunction(inspectTerminal, prompt, { timeout: timeoutMs })
  try {
    return await handle.jsonValue()
  } finally {
    await handle.dispose()
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
    const host = release?.terminalHost
    if (
      host?.type !== 'hello' ||
      host.version !== protocolVersion ||
      !Number.isInteger(host.pid) ||
      !(host.pid > 0)
    ) {
      failures.push(`terminal check: ${name} terminal host hello is missing or invalid`)
      continue
    }
    if (
      typeof release?.server?.release !== 'string' ||
      host.build?.commit !== release?.server?.commit ||
      host.build?.release !== release?.server?.release ||
      host.build?.dirtyFiles !== 0
    )
      failures.push(`terminal check: ${name} terminal host build differs from ${name} server`)
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
