export function emptyWorkbenchUrl(base) {
  return new URL('~-/workbench?tabs=-', base).href
}

function inspectTerminal(prompt) {
  const hosts = Array.from(
    document.querySelectorAll('[data-slot="tool-pane"][aria-label="Terminal"] .ghostty-webgpu'),
  ).filter((host) => host.checkVisibility())
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
