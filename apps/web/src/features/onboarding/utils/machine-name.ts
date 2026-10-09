/** The primary machine's name in a sentence, before its server has reported one. */
export function machineName(label: string | null) {
  return label ?? 'the Fregat server'
}
