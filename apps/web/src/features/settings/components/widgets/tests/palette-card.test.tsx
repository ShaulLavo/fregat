import { bundledPalette, parseColor, toHex } from '@workspace/contracts'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { ColorField } from '../color-field'
import { PaletteCard } from '../palette-card'
import { PaletteContrast } from '../palette-contrast'

const sage = bundledPalette('sage')!

describe('PaletteCard', () => {
  it('previews on keyboard focus only, clears on blur, selects on click', async () => {
    const onPreview = vi.fn()
    const onPreviewEnd = vi.fn()
    const onSelect = vi.fn()
    render(
      <PaletteCard
        disabled={false}
        menu={null}
        onPreview={onPreview}
        onPreviewEnd={onPreviewEnd}
        onSelect={onSelect}
        palette={sage}
        selected={false}
      />,
    )
    const radio = screen.getByRole('radio', { name: /Sage/ })
    expect(radio).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByRole('img', { name: 'Sage light' })).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Sage dark' })).toBeInTheDocument()

    fireEvent.mouseEnter(radio)
    expect(onPreview).not.toHaveBeenCalled()
    await userEvent.tab()
    expect(radio).toHaveFocus()
    expect(onPreview).toHaveBeenCalledTimes(1)
    await userEvent.tab()
    expect(onPreviewEnd).toHaveBeenCalledTimes(1)
    await userEvent.click(radio)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })
})

describe('ColorField', () => {
  it('commits a pasted hex on Enter and keeps alpha through the picker', () => {
    const onChange = vi.fn()
    const value = parseColor('#ff000080')!
    render(<ColorField id='f' label='Border' onChange={onChange} value={value} />)
    const text = screen.getByRole('textbox', { name: 'Border' })
    expect(text).toHaveValue('#ff000080')

    fireEvent.change(text, { target: { value: '#00ff00' } })
    fireEvent.keyDown(text, { key: 'Enter' })
    expect(toHex(onChange.mock.calls[0]![0])).toBe('#00ff00')

    fireEvent.change(screen.getByLabelText('Border picker'), { target: { value: '#0000ff' } })
    expect(toHex(onChange.mock.calls[1]![0])).toBe('#0000ff80')

    fireEvent.change(text, { target: { value: 'nonsense' } })
    expect(text).toHaveAttribute('aria-invalid', 'true')
    fireEvent.keyDown(text, { key: 'Escape' })
    expect(text).toHaveValue('#ff000080')
  })
})

describe('PaletteContrast', () => {
  it('lists a failing pair with its ratio', () => {
    const dark = sage.variants.kind === 'paired' ? sage.variants.dark : sage.variants.colors
    const broken = { ...dark, app: { ...dark.app, foreground: dark.app.background } }
    render(<PaletteContrast colors={broken} />)
    expect(screen.getByRole('status')).toHaveTextContent('Foreground on Background')
    expect(screen.getByRole('status')).toHaveTextContent('1.00:1')
  })
})
