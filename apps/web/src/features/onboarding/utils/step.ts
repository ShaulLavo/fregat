/** Where the first-workspace flow is: one dialog at a time, or none. */
export type Step =
  | { readonly kind: 'closed' }
  | { readonly kind: 'choose' }
  | { readonly kind: 'local' }
  | { readonly kind: 'remote' }
  | { readonly kind: 'machine'; readonly name: string }

export const CLOSED: Step = { kind: 'closed' }
export const CHOOSE: Step = { kind: 'choose' }
export const LOCAL: Step = { kind: 'local' }
export const REMOTE: Step = { kind: 'remote' }

/** A picker closing after its pick must not undo the step the pick moved to. */
export function leaving(from: Step['kind'], to: Step) {
  return (current: Step | null) => (current?.kind === from ? to : current)
}
