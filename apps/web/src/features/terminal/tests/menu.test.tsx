import { screen } from '@testing-library/react'
import type { Terminal } from 'ghostty-webgpu'

import { TerminalMenu } from '@/features/terminal/components/menu'
import type { TerminalMenuTarget } from '@/features/terminal/utils/commands'
import type { TerminalRendererBackend } from '@/features/terminal/utils/renderer-backend'
import { pointAnchor } from '@/keymap/menus/utils/virtual-anchor'
import { expect, test } from '../../../../test/fixtures'
import { renderWithProviders } from '../../../../test/render'

const TIERS: readonly (readonly [TerminalRendererBackend, string])[] = [
  ['webgpu', 'Renderer: WebGPU'],
  ['webgl2', 'Renderer: WebGL2'],
  ['canvas2d', 'Renderer: Canvas'],
  [undefined, 'Renderer: starting'],
]

for (const [backend, label] of TIERS) {
  test(`the menu reads "${label}" for ${backend ?? 'a terminal still opening'}`, async () => {
    renderWithProviders(
      <TerminalMenu
        anchor={pointAnchor(10, 10)}
        onOpenChange={() => {}}
        target={menuTarget(backend)}
      />,
    )

    const row = await screen.findByRole('menuitem', { name: label })

    expect(row).toHaveAttribute('aria-disabled', 'true')
    expect(screen.getByText(label)).toHaveClass('font-mono')
  })
}

function menuTarget(rendererBackend: TerminalRendererBackend): TerminalMenuTarget {
  return {
    clearHistory: () => {},
    contextSelection: null,
    hasScrollback: false,
    rendererBackend,
    selection: '',
    restart: () => {},
    // ghostty needs wasm and a GPU canvas, which happy-dom lacks; no item here runs.
    terminal: {} as Terminal,
  }
}
