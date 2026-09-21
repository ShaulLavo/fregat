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
      fontSize: 18,
    })

    expect(terminal.setFont).toHaveBeenCalledWith({ size: 18 })
    expect(terminal.setCursor).toHaveBeenCalledWith({ blink: false })
  })

  it('does nothing before the terminal exists', () => {
    expect(() => applyTerminalAppearance(null, { cursorBlink: true, fontSize: 12 })).not.toThrow()
  })
})
