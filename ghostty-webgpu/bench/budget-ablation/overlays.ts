import assert from 'node:assert/strict'

// This module is build-only research tooling. No diagnostic arm is a product candidate.
export function entryOverlay(source: string, cellOracle: string): string {
  let text = source
  const once = (old: string, next: string) => {
    assert.equal(text.split(old).length, 2, old)
    text = text.replace(old, next)
  }
  once(
    "import { WebglAddon } from '@xterm/addon-webgl'",
    "import { WebglAddon } from '@xterm/addon-webgl'\nimport { Unicode11Addon } from '@xterm/addon-unicode11'\nimport { ZigFrameBuilder } from '../src/core/zig-frame.js'",
  )
  once(
    'const accessibility =',
    `const arm = new URLSearchParams(location.search).get('arm') ?? 'GFULL'
const parserOnly = arm === 'GPARSE' || arm === 'XPARSE'
const budget = { nativeFrames: 0, gl: {} as Record<string, number> }
Object.assign(window, { __budget: budget })
const nativeBuild = ZigFrameBuilder.prototype.build
ZigFrameBuilder.prototype.build = function (...args) {
  budget.nativeFrames++
  return nativeBuild.apply(this, args)
}
for (const name of ['bufferData', 'bufferSubData', 'texImage2D', 'texSubImage2D', 'texImage3D', 'texSubImage3D', 'drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced', 'clear', 'bindBuffer', 'bindTexture', 'bindFramebuffer', 'useProgram', 'viewport', 'uniform2f', 'uniform1i', 'enable', 'disable', 'blendFunc', 'blendFuncSeparate', 'pixelStorei', 'copyTexSubImage2D', 'copyTexSubImage3D', 'blitFramebuffer', 'flush', 'finish']) {
  const prototype = WebGL2RenderingContext.prototype as any
  const original = prototype[name]
  if (typeof original !== 'function') continue
  prototype[name] = function (...args: any[]) {
    budget.gl[name] = (budget.gl[name] ?? 0) + 1
    return original.apply(this, args)
  }
}
const budgetSnapshot = () => ({ nativeFrames: budget.nativeFrames, gl: { ...budget.gl } })
const accessibility =`,
  )
  once(
    '    text: () => terminal.visibleLines(),',
    "    text: () => ['GFRAME', 'GSKIP'].includes(arm) ? core.readLines(core.lineCount() - settings.rows, core.lineCount()).map(line => line.text) : terminal.visibleLines(),",
  )
  once(
    '  let mountedRenderer:',
    `  if (parserOnly) {
    host.style.width = '280px'
    host.style.height = '228px'
    const terminal = {
      write: (data: string | Uint8Array) => session.write(data),
      lineCount: () => core.lineCount(),
      readLines: (start: number, end: number) => core.readLines(start, end),
    }
    directAdd({ kind: 'native', terminal, session, core, renderer: undefined, host })
    return {
      write: async (data) => { terminal.write(data) },
      text: () => core.readLines(core.lineCount() - settings.rows, core.lineCount()).map(line => line.text),
      history: () => core.lineCount() - settings.rows,
      focus: () => {}, onData: () => {}, dispose: () => session.dispose(),
    }
  }
  let mountedRenderer:`,
  )
  once(
    '    scrollback: settings.scrollback,',
    '    scrollback: settings.scrollback,\n    allowProposedApi: true,',
  )
  once(
    '  terminal.open(host)\n  let observedRenderer: unknown',
    `  terminal.loadAddon(new Unicode11Addon())
  terminal.unicode.activeVersion = '11'
  if (!parserOnly) terminal.open(host)
  if (parserOnly) { host.style.width = '280px'; host.style.height = '228px' }
  let observedRenderer: unknown`,
  )
  once(
    "  if (current.variant === 'xterm-webgl') {",
    "  if (!parserOnly && current.variant === 'xterm-webgl') {",
  )
  once(
    '  } else {\n    tracing.xtermDom(drivers.length, terminal)',
    '  } else if (!parserOnly) {\n    tracing.xtermDom(drivers.length, terminal)',
  )
  once(
    "    observe(actor, actor.renderer, 'drawFrame', 'rendererCallbacks')",
    "    if (actor.renderer) observe(actor, actor.renderer, 'drawFrame', 'rendererCallbacks')",
  )
  once(
    "    observe(actor, actor.renderer, 'notifyScroll', 'actualScrollNotifications')",
    "    if (actor.renderer) observe(actor, actor.renderer, 'notifyScroll', 'actualScrollNotifications')",
  )
  once(
    "    observe(actor, actor.terminal, 'handleFrame', 'actualFramePublications')",
    "    if (actor.renderer) {\n      observe(actor, actor.terminal, 'handleFrame', 'actualFramePublications')\n      observe(actor, Reflect.get(actor.renderer, 'frames'), 'updateRows', 'copiedRowCaptures')\n    }\n    observe(actor, actor.session.renderState, 'readTextRows', 'copiedTextReads')",
  )
  once(
    "    observe(actor, actor.renderer, 'renderRows', 'rendererCallbacks')",
    "    if (actor.renderer) observe(actor, actor.renderer, 'renderRows', 'rendererCallbacks')",
  )
  once(
    "      fullRebuild: Reflect.get(actor.renderer, 'needsFullRebuild'),",
    "      fullRebuild: actor.renderer ? Reflect.get(actor.renderer, 'needsFullRebuild') : undefined,",
  )
  text = text.replaceAll('actor.renderer.', 'actor.renderer?.')
  text = text.replace(
    'actor.core._renderService._renderDebouncer._animationFrame',
    'actor.core._renderService?._renderDebouncer?._animationFrame',
  )
  once(
    '    const before = directSnapshot(false)',
    '    for (const actor of directActors) actor.inputs = []\n    const budgetBefore = budgetSnapshot()\n    const before = directSnapshot(false)',
  )
  once(
    '  counters: Record<string, number>\n}',
    '  counters: Record<string, number>\n  inputs?: (string | Uint8Array)[]\n}',
  )
  once(
    '    actor.counters.publicWrites++',
    '    actor.inputs?.push(data)\n    actor.counters.publicWrites++',
  )
  once(
    '  content: directContent,',
    `  content: directContent,
  inputProof: async () => {
    const result = []
    for (const actor of directActors) {
      const chunks = actor.inputs ?? []
      const values = chunks.map(chunk => typeof chunk === 'string' ? encoder.encode(chunk) : chunk)
      const headers = values.map(bytes => encoder.encode(bytes.length + '\\0'))
      const joined = new Uint8Array(values.reduce((size, bytes, i) => size + bytes.length + headers[i]!.length, 0))
      let offset = 0
      for (let i = 0; i < values.length; i++) {
        joined.set(headers[i]!, offset); offset += headers[i]!.length
        joined.set(values[i]!, offset); offset += values[i]!.length
      }
      const digest = await crypto.subtle.digest('SHA-256', joined)
      result.push({calls: chunks.length, byteLengths: values.map(bytes => bytes.length), framedInputSha256: Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')})
    }
    return result
  },`,
  )
  once(
    '      before,\n      stock,\n      after,',
    '      arm, budgetBefore, budgetAfter: budgetSnapshot(),\n      before,\n      stock,\n      after,',
  )
  return text + '\n' + cellOracle
}

export function runtimeOverlay(path: string, source: string): string {
  const frameOnly = "new URLSearchParams(location.search).get('arm') === 'GFRAME'"
  const skipPublication =
    "['GFRAME', 'GSKIP'].includes(new URLSearchParams(location.search).get('arm') ?? '')"
  const once = (old: string, next: string) => {
    assert.equal(source.split(old).length, 2, path + ': ' + old)
    source = source.replace(old, next)
  }
  if (path.endsWith('/render/frame-observer.ts')) {
    once(
      'if (this.rowsNeeded) this.updateRows(state, changed, rows)',
      `if (!(${skipPublication}) && this.rowsNeeded) this.updateRows(state, changed, rows)`,
    )
  }
  if (path.endsWith('/dom/execution-local.ts')) {
    const start = source.indexOf('    const rows =\n      snapshot.rows.length > 0')
    const end = source.indexOf('    this.lastFrame = Object.freeze', start)
    assert(start >= 0 && end > start, path)
    const block = source.slice(start, end).replace('    const rows =', '')
    source =
      source.slice(0, start) +
      `    const rows = (${skipPublication}) ? snapshot.rows : ${block}` +
      source.slice(end)
  }
  if (path.endsWith('/render/webgl/text-pass.ts')) {
    once(
      '  syncAtlas(uploads: readonly AtlasPageUpload[]): void {',
      `  syncAtlas(uploads: readonly AtlasPageUpload[]): void {\n    if (${frameOnly}) return`,
    )
    once('  submit(): void {', `  submit(): void {\n    if (${frameOnly}) return`)
    once(
      '    if (ranges.length === 0) return',
      `    if (${frameOnly}) return\n    if (ranges.length === 0) return`,
    )
  }
  return source
}
