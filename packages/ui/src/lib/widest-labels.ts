/** Every label a trigger may show, once each, with the current one included even if unlisted. */
export function widestLabels(labels: readonly string[], current: string): readonly string[] {
  return [...new Set([...labels, current])]
}
