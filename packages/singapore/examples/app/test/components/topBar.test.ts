import { describe, expect, it } from 'vitest'

import { createTopBar } from '../../src/components/topBar.ts'

describe('createTopBar', () => {
  it('tracks repository status', () => {
    const topBar = createTopBar()

    topBar.setRepositoryName('ShaulLavo/singapore')
    expect(topBar.element.querySelector('#dir-name')?.textContent).toBe('ShaulLavo/singapore')

    topBar.setBusyState(true)
    expect(topBar.element.querySelectorAll('button')).toHaveLength(2)

    topBar.setMessage('Failed')
    expect(topBar.element.querySelector('#dir-name')?.textContent).toBe('Failed')
  })

  it('updates view controls', () => {
    const topBar = createTopBar()
    const buttons = topBar.element.querySelectorAll('button')

    topBar.setViewMode('diff')

    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false')
    expect(buttons[1]?.getAttribute('aria-pressed')).toBe('true')
  })
})
