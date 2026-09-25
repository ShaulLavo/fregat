import { describe, expect, it, vi } from 'vitest'

import { applyTerminalAppearance } from '@/features/terminal/utils/appearance'

function fakeTerminal() {
  return { setCursor: vi.fn(), setFont: vi.fn() }
}

describe('applyTerminalAppearance', () => {
  it('projects live font and cursor settings through the native api', () => {
    const terminal = fakeTerminal()

    applyTerminalAppearance(terminal as never, {
      cursorBlink: false,
      fontFamily: '"FiraCode Nerd Font", monospace',
      fontSize: 18,
    })

    expect(terminal.setFont).toHaveBeenCalledWith({
      family: '"FiraCode Nerd Font", monospace',
      size: 18,
    })
    expect(terminal.setCursor).toHaveBeenCalledWith({ blink: false })
  })

  it('does nothing before the terminal exists', () => {
    expect(() =>
      applyTerminalAppearance(null, { cursorBlink: true, fontFamily: 'monospace', fontSize: 12 }),
    ).not.toThrow()
  })
})
