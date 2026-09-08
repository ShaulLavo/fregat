import { fireEvent, screen } from '@testing-library/react'
import { describe, vi } from 'vitest'

import { DiagnosticPeek } from '@/features/editor/components/diagnostic-peek'
import type { DiagnosticPeekModel } from '@/features/editor/state/diagnostic-peek-source'
import { expect, test } from '../../../../../test/fixtures'
import { renderWithProviders } from '../../../../../test/render'

describe('DiagnosticPeek', () => {
  test('renders diagnostic metadata and opens related information', () => {
    const onClose = vi.fn()
    const onOpenTarget = vi.fn()
    renderWithProviders(
      <div className='relative h-80 w-160'>
        <DiagnosticPeek
          model={model()}
          onClose={onClose}
          onOpenTarget={onOpenTarget}
          tabId='tab-a'
        />
      </div>,
      { command: false },
    )

    expect(screen.getByRole('dialog', { name: 'Error diagnostic' })).toHaveClass(
      'bg-popover-solid',
      'max-h-[calc(100%-1rem)]',
      'overflow-y-auto',
    )
    expect(screen.getByText('Unknown name')).toBeVisible()
    expect(screen.getByText('typescript · TS100')).toBeVisible()
    expect(screen.getByText('3:3')).toHaveClass('tabular-nums')

    fireEvent.click(screen.getByRole('button', { name: /Declared here/ }))
    expect(onClose).toHaveBeenCalledWith(false)
    expect(onOpenTarget).toHaveBeenCalledWith(model().relatedInformation[0]?.target)
  })

  test('closes with origin restoration from the close control', () => {
    const onClose = vi.fn()
    renderWithProviders(<DiagnosticPeek model={model()} onClose={onClose} tabId='tab-a' />, {
      command: false,
    })

    fireEvent.click(screen.getByRole('button', { name: 'Close diagnostic' }))
    expect(onClose).toHaveBeenCalledWith(true)
  })
})

function model(): DiagnosticPeekModel {
  return {
    code: 'TS100',
    direction: 'next',
    documentUri: 'file:///repo/a.ts',
    geometry: {
      anchorRect: rect(100, 100, 20, 18),
      clipRect: rect(0, 0, 640, 320),
      kind: 'visible',
      range: { start: 6, end: 11 },
    },
    message: 'Unknown name',
    relatedInformation: [
      {
        column: 3,
        label: 'Declared here',
        line: 3,
        target: {
          path: 'repo/b.ts',
          range: { start: { line: 2, character: 2 }, end: { line: 2, character: 5 } },
          uri: 'file:///repo/b.ts',
        },
      },
    ],
    severity: 'Error',
    source: 'typescript',
  }
}

function rect(left: number, top: number, width: number, height: number) {
  return { bottom: top + height, height, left, right: left + width, top, width }
}
