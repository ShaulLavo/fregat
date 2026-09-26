import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { StringWidget } from '../components/widgets/string-widget'

describe('StringWidget', () => {
  it('commits the trimmed value once on Enter', async () => {
    const onCommit = vi.fn()
    render(<StringWidget id='x' onCommit={onCommit} value='old' />)

    const field = screen.getByRole('textbox')
    await userEvent.clear(field)
    await userEvent.type(field, '  new  ')
    expect(onCommit).not.toHaveBeenCalled()

    await userEvent.type(field, '{Enter}')
    expect(onCommit).toHaveBeenCalledTimes(1)
    expect(onCommit).toHaveBeenCalledWith('new')
  })

  it('snaps a blank field back without committing', async () => {
    const onCommit = vi.fn()
    render(<StringWidget id='x' onCommit={onCommit} value='old' />)

    const field = screen.getByRole('textbox')
    await userEvent.clear(field)
    await userEvent.type(field, '   ')
    await userEvent.tab()

    expect(onCommit).not.toHaveBeenCalled()
    expect(field).toHaveValue('old')
  })

  it('commits a blank field when verbatim', async () => {
    const onCommit = vi.fn()
    render(<StringWidget id='x' onCommit={onCommit} value='old' verbatim />)

    await userEvent.clear(screen.getByRole('textbox'))
    await userEvent.tab()

    expect(onCommit).toHaveBeenCalledWith('')
  })

  it('ignores an incoming value while the field has focus', async () => {
    const onCommit = vi.fn()
    const { rerender } = render(<StringWidget id='x' onCommit={onCommit} value='old' />)

    const field = screen.getByRole('textbox')
    await userEvent.clear(field)
    await userEvent.type(field, 'typing')
    rerender(<StringWidget id='x' onCommit={onCommit} value='server' />)

    expect(field).toHaveValue('typing')
  })

  it('snaps back on Escape without committing', async () => {
    const onCommit = vi.fn()
    render(<StringWidget id='x' onCommit={onCommit} value='old' />)

    const field = screen.getByRole('textbox')
    await userEvent.clear(field)
    await userEvent.type(field, 'new{Escape}')

    expect(onCommit).not.toHaveBeenCalled()
    expect(field).toHaveValue('old')
  })
})
