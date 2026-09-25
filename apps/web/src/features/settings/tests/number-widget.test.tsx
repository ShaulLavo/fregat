import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { NumberWidget } from '../components/widgets/number-widget'

describe('NumberWidget', () => {
  it('commits once on Enter, not per keystroke', async () => {
    const onCommit = vi.fn()
    render(<NumberWidget id='x' onCommit={onCommit} value={80} />)

    const field = screen.getByRole('spinbutton')
    await userEvent.clear(field)
    await userEvent.type(field, '100')

    // Typing "100" through a per-keystroke widget writes 1, then 10, then 100 —
    // two of which the user never meant.
    expect(onCommit).not.toHaveBeenCalled()

    await userEvent.type(field, '{Enter}')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith(100)
  })

  it('commits on blur', async () => {
    const onCommit = vi.fn()
    render(<NumberWidget id='x' onCommit={onCommit} value={80} />)

    const field = screen.getByRole('spinbutton')
    await userEvent.clear(field)
    await userEvent.type(field, '42')
    await userEvent.tab()

    expect(onCommit).toHaveBeenCalledWith(42)
  })

  it('snaps a blank field back without committing a zero', async () => {
    const onCommit = vi.fn()
    render(<NumberWidget id='x' onCommit={onCommit} value={80} />)

    const field = screen.getByRole('spinbutton')
    await userEvent.clear(field)
    await userEvent.tab()

    expect(onCommit).not.toHaveBeenCalled()
    expect(field).toHaveValue(80)
  })

  it('ignores an incoming value while the field has focus', async () => {
    const onCommit = vi.fn()
    const { rerender } = render(<NumberWidget id='x' onCommit={onCommit} value={80} />)

    const field = screen.getByRole('spinbutton')
    await userEvent.clear(field)
    await userEvent.type(field, '55')

    // The snapshot coming back from the user's own save, arriving mid-typing.
    rerender(<NumberWidget id='x' onCommit={onCommit} value={90} />)

    expect(field).toHaveValue(55)
  })

  it('accepts an incoming value once focus has left', async () => {
    const onCommit = vi.fn()
    const { rerender } = render(<NumberWidget id='x' onCommit={onCommit} value={80} />)

    await userEvent.click(screen.getByRole('spinbutton'))
    await userEvent.tab()
    rerender(<NumberWidget id='x' onCommit={onCommit} value={90} />)

    expect(screen.getByRole('spinbutton')).toHaveValue(90)
  })

  it('snaps back on Escape without committing', async () => {
    const onCommit = vi.fn()
    render(<NumberWidget id='x' onCommit={onCommit} value={80} />)

    const field = screen.getByRole('spinbutton')
    await userEvent.clear(field)
    await userEvent.type(field, '7{Escape}')

    expect(onCommit).not.toHaveBeenCalled()
    expect(field).toHaveValue(80)
  })
})
