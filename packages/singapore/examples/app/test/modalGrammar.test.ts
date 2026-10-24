import { describe, expect, it } from 'vitest'
import { modalStep, NORMAL, type ModalState } from '../src/modal/grammar'

function run(keys: readonly string[], state: ModalState = NORMAL) {
  const actions = []
  let current = state
  for (const key of keys) {
    const step = modalStep(current, key)
    current = step.state
    actions.push(step.action)
  }
  return { state: current, actions: actions.filter((action) => action.kind !== 'none') }
}

describe('modal grammar', () => {
  it('multiplies a count before the operator by one after it', () => {
    expect(run(['2', 'd', '3', 'w']).actions).toEqual([{ kind: 'delete', motion: 'w', count: 6 }])
  })

  it('reads 0 as a motion unless it continues a count', () => {
    expect(run(['0']).actions).toEqual([{ kind: 'move', motion: '0', count: 1 }])
    expect(run(['1', '0', 'l']).actions).toEqual([{ kind: 'move', motion: 'l', count: 10 }])
  })

  it('cancels a pending operator and count on Escape', () => {
    const { state, actions } = run(['3', 'd', 'Escape'])
    expect(state).toEqual(NORMAL)
    expect(actions).toEqual([])
  })

  it('drops an inner object that is not a word', () => {
    const { state, actions } = run(['d', 'i', 'x'])
    expect(actions).toEqual([])
    expect(state).toEqual(NORMAL)
  })

  it('leaves insert mode only on Escape', () => {
    const inserting = run(['i']).state
    expect(run(['x', 'd', 'd'], inserting).state.kind).toBe('insert')
    expect(run(['Escape'], inserting).actions).toEqual([{ kind: 'normal' }])
  })
})
