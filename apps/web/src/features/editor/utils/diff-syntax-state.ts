/** What a diff pane's syntax colour is waiting on, as its `data-syntax` attribute reports it. */
export function diffSyntaxState(highlight: boolean | undefined, ready: boolean) {
  if (!highlight) return 'off'
  return ready ? 'ready' : 'pending'
}
