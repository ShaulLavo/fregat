import assert from 'node:assert/strict'
import { act } from 'react'
import { bundledPalette } from '@workspace/contracts'
import { MarkdownRenderable, type Renderable } from '@opentui/core'
import { resolveTheme } from '@/theme/utils/theme'
import { terminalColorMode } from '@/host/utils/capabilities'
import type { renderAgentStage } from './agent-stage'

export async function setAgentTheme(
  app: Awaited<ReturnType<typeof renderAgentStage>>,
  appearance: 'dark' | 'light',
  palette: 'graphite' | 'sage',
) {
  const state = app.session.getSnapshot()
  assert(state.kind === 'ready')
  await act(async () => {
    const saved = state.owner.submit('user', [
      { kind: 'set', key: 'workbench.colorTheme', value: appearance },
      { kind: 'set', key: 'workbench.palette', value: palette },
    ])
    assert(saved.kind === 'submitted')
    await saved.settled
  })
  await app.frame.renderOnce()
  return resolveTheme(appearance, 'dark', false, {
    palette: bundledPalette(palette),
    colorMode: terminalColorMode(app.frame.renderer.capabilities, false),
  })
}

export function findMarkdown(root: Renderable, text: string) {
  const pending = [root]
  while (pending.length) {
    const node = pending.pop()
    if (!node) continue
    if (node instanceof MarkdownRenderable && node.content.includes(text)) return node
    pending.push(...node.getChildren())
  }
}
