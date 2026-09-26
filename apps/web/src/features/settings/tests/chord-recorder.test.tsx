import { fireEvent, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, vi } from 'vitest'

import { expect, test } from '../../../../test/fixtures'
import { binding } from '../../../../test/factories/key-binding'
import { renderWithProviders as render } from '../../../../test/render'
import { formatChord } from '@/keymap/utils/format-keys'

import { ChordRecorder } from '@/features/settings/components/widgets/chord-recorder'

function record(chord: Partial<KeyboardEvent> & { key: string }) {
  fireEvent.keyDown(screen.getByRole('button'), chord)
}

describe('ChordRecorder', () => {
  test('captures a single shortcut from the keystroke instead of asking for notation', async () => {
    const onChange = vi.fn()
    render(<ChordRecorder conflictCount={0} id='k' onChange={onChange} value='' />)

    await userEvent.click(screen.getByRole('button'))
    record({ key: 's', ctrlKey: true, shiftKey: true })

    // Recorded modifiers remain portable across keyboards.
    expect(onChange).toHaveBeenCalledWith(expect.stringContaining('Mod'))
    expect(onChange.mock.calls[0]?.[0]).toContain('Shift')
  })

  test('ignores a modifier pressed on its own', async () => {
    const onChange = vi.fn()
    render(<ChordRecorder conflictCount={0} id='k' onChange={onChange} value='' />)

    await userEvent.click(screen.getByRole('button'))
    record({ key: 'Meta', metaKey: true })

    expect(onChange).not.toHaveBeenCalled()
  })

  test('cancels on Escape rather than binding it', async () => {
    const onChange = vi.fn()
    render(<ChordRecorder conflictCount={0} id='k' onChange={onChange} value='Mod+S' />)

    await userEvent.click(screen.getByRole('button'))
    record({ key: 'Escape' })

    expect(onChange).not.toHaveBeenCalled()
    expect(screen.getByRole('button')).toHaveTextContent(formatChord('Mod+S'))
  })

  test('does not record until asked', () => {
    const onChange = vi.fn()
    render(<ChordRecorder conflictCount={0} id='k' onChange={onChange} value='' />)

    record({ key: 's', metaKey: true })

    // Otherwise every keystroke that reached a focused row would rebind it.
    expect(onChange).not.toHaveBeenCalled()
  })

  test('warns when other commands already use the chord', () => {
    const { container } = render(
      <ChordRecorder conflictCount={2} id='k' onChange={vi.fn()} value='Mod+S' />,
    )

    // Before the save, rather than discovered later by a shortcut that stopped
    // working.
    expect(container.textContent).toContain('2 other commands use this')
  })

  test('says nothing when the chord is free', () => {
    const { container } = render(
      <ChordRecorder conflictCount={0} id='k' onChange={vi.fn()} value='Mod+S' />,
    )

    expect(container.textContent).not.toContain('use this')
  })

  test('says unassigned rather than showing an empty control', () => {
    render(<ChordRecorder conflictCount={0} id='k' onChange={vi.fn()} value='' />)

    expect(screen.getByRole('button')).toHaveTextContent('Unassigned')
  })
})

test('records two strokes on a live prefix and shows the partial shortcut', async () => {
  const onChange = vi.fn()
  render(
    <ChordRecorder
      bindings={[binding('Mod+K Mod+S')]}
      conflictCount={0}
      id='k'
      onChange={onChange}
      value=''
    />,
  )
  await userEvent.click(screen.getByRole('button'))

  record({ key: 'k', ctrlKey: true })
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toHaveTextContent(`${formatChord('Mod+K')} …`)

  record({ key: 's', ctrlKey: true })
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Mod+K Mod+S')
})

test('Enter commits a pending prefix as a single shortcut', async () => {
  const onChange = vi.fn()
  render(
    <ChordRecorder
      bindings={[binding('Mod+K Mod+S')]}
      conflictCount={0}
      id='k'
      onChange={onChange}
      value=''
    />,
  )
  await userEvent.click(screen.getByRole('button'))
  record({ key: 'k', ctrlKey: true })
  record({ key: 'Enter' })
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Mod+K')
})

test('Backspace removes a pending stroke before recording its replacement', async () => {
  const onChange = vi.fn()
  render(
    <ChordRecorder
      bindings={[binding('Mod+K Mod+S')]}
      conflictCount={0}
      id='k'
      onChange={onChange}
      value=''
    />,
  )
  await userEvent.click(screen.getByRole('button'))
  record({ key: 'k', ctrlKey: true })
  record({ key: 'Backspace' })
  expect(screen.getByRole('button')).toHaveTextContent('Press a shortcut…')
  expect(onChange).not.toHaveBeenCalled()
  record({ key: 'j', ctrlKey: true, altKey: true })
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Mod+Alt+J')
})

test('Escape cancels a pending prefix without changing the original shortcut', async () => {
  const onChange = vi.fn()
  render(
    <ChordRecorder
      bindings={[binding('Mod+K Mod+S')]}
      conflictCount={0}
      id='k'
      onChange={onChange}
      value='Mod+J'
    />,
  )
  await userEvent.click(screen.getByRole('button'))
  record({ key: 'k', ctrlKey: true })
  record({ key: 'Escape' })
  expect(onChange).not.toHaveBeenCalled()
  expect(screen.getByRole('button')).toHaveTextContent(formatChord('Mod+J'))
})

test('ignores held keys and IME input without advancing a pending prefix', async () => {
  const onChange = vi.fn()
  render(
    <ChordRecorder
      bindings={[binding('Mod+K Mod+S')]}
      conflictCount={0}
      id='k'
      onChange={onChange}
      value=''
    />,
  )
  await userEvent.click(screen.getByRole('button'))
  record({ key: 'k', ctrlKey: true })
  record({ key: 'k', ctrlKey: true, repeat: true })
  record({ key: 's', ctrlKey: true, isComposing: true })
  record({ key: 's', ctrlKey: true, keyCode: 229 })
  expect(onChange).not.toHaveBeenCalled()
  record({ key: 's', ctrlKey: true })
  expect(onChange).toHaveBeenCalledExactlyOnceWith('Mod+K Mod+S')
})

test.each(['Backspace', 'Enter', 'Escape'])(
  'records modified %s as a continuation instead of a recorder control',
  async (key) => {
    const onChange = vi.fn()
    render(
      <ChordRecorder
        bindings={[binding('Mod+K Mod+S')]}
        conflictCount={0}
        id='k'
        onChange={onChange}
        value=''
      />,
    )
    await userEvent.click(screen.getByRole('button'))
    record({ key: 'k', ctrlKey: true })
    record({ key, ctrlKey: true })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(`Mod+K Mod+${key}`)
  },
)

test.each([false, true])(
  'records Backspace as the first stroke with Control=%s',
  async (ctrlKey) => {
    const onChange = vi.fn()
    render(<ChordRecorder conflictCount={0} id='k' onChange={onChange} value='' />)
    await userEvent.click(screen.getByRole('button'))
    record({ key: 'Backspace', ctrlKey })
    expect(onChange).toHaveBeenCalledExactlyOnceWith(ctrlKey ? 'Mod+Backspace' : 'Backspace')
  },
)
