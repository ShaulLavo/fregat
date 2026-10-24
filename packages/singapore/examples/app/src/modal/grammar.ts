// The finite modal grammar the proof supports, as a pure state machine: a key in, the next state and
// the one action to take out. Everything the editor does with the action lives in the plugin.

export type ModalMotion = 'h' | 'j' | 'k' | 'l' | 'w' | 'b' | '0' | '$'

export type ModalState =
  | { readonly kind: 'insert' }
  | {
      readonly kind: 'normal'
      /** Digits typed so far, before or after an operator. */
      readonly count: number | null
      /** `d` waiting for its motion, with the count typed before it. */
      readonly operator: { readonly count: number } | null
      /** `i` after `d`, waiting for the object (`w`). */
      readonly inner: boolean
    }

export type ModalAction =
  | { readonly kind: 'none' }
  | { readonly kind: 'insert'; readonly after: boolean }
  | { readonly kind: 'normal' }
  | { readonly kind: 'move'; readonly motion: ModalMotion; readonly count: number }
  | { readonly kind: 'delete'; readonly motion: ModalMotion; readonly count: number }
  | { readonly kind: 'deleteLines'; readonly count: number }
  | { readonly kind: 'deleteInnerWord' }
  | { readonly kind: 'undo' }

type NormalState = Extract<ModalState, { kind: 'normal' }>

export const NORMAL: NormalState = { kind: 'normal', count: null, operator: null, inner: false }

const MOTIONS = new Set<string>(['h', 'j', 'k', 'l', 'w', 'b', '0', '$'])

type Step = { readonly state: ModalState; readonly action: ModalAction }

const none = (state: ModalState): Step => ({ state, action: { kind: 'none' } })

/** Whether `key` belongs to the grammar in `state`; a key outside it is left to the editor. */
export function modalHandles(state: ModalState, key: string): boolean {
  if (state.kind === 'insert') return key === 'Escape'
  return key.length === 1 || key === 'Escape'
}

export function modalStep(state: ModalState, key: string): Step {
  if (state.kind === 'insert') {
    return key === 'Escape' ? { state: NORMAL, action: { kind: 'normal' } } : none(state)
  }
  if (key === 'Escape') return none(NORMAL)
  if (isCountDigit(state, key))
    return none({ ...state, count: (state.count ?? 0) * 10 + Number(key) })
  if (state.inner) return innerStep(state, key)
  if (state.operator) return operatorStep(state, state.operator.count, key)
  return idleStep(state, key)
}

// `0` is a motion unless it continues a count.
function isCountDigit(state: Extract<ModalState, { kind: 'normal' }>, key: string): boolean {
  if (!/^[0-9]$/.test(key)) return false
  return key !== '0' || state.count !== null
}

function idleStep(state: Extract<ModalState, { kind: 'normal' }>, key: string): Step {
  const count = state.count ?? 1
  if (key === 'i') return { state: { kind: 'insert' }, action: { kind: 'insert', after: false } }
  if (key === 'a') return { state: { kind: 'insert' }, action: { kind: 'insert', after: true } }
  if (key === 'u') return { state: NORMAL, action: { kind: 'undo' } }
  if (key === 'd') return none({ ...NORMAL, operator: { count } })
  if (MOTIONS.has(key)) {
    return { state: NORMAL, action: { kind: 'move', motion: key as ModalMotion, count } }
  }
  return none(NORMAL)
}

function operatorStep(
  state: Extract<ModalState, { kind: 'normal' }>,
  operatorCount: number,
  key: string,
): Step {
  const count = operatorCount * (state.count ?? 1)
  if (key === 'd') return { state: NORMAL, action: { kind: 'deleteLines', count } }
  if (key === 'i') return none({ ...state, inner: true })
  if (MOTIONS.has(key)) {
    return { state: NORMAL, action: { kind: 'delete', motion: key as ModalMotion, count } }
  }
  return none(NORMAL)
}

function innerStep(state: Extract<ModalState, { kind: 'normal' }>, key: string): Step {
  if (key === 'w') return { state: NORMAL, action: { kind: 'deleteInnerWord' } }
  return none({ ...state, inner: false, operator: null, count: null })
}
