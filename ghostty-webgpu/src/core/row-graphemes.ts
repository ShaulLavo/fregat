const emptyGraphemes = new Uint32Array(0)

export function copyRowGraphemes(
  words: Uint32Array,
  graphemes: Uint32Array,
  cellWords: number,
  startWord: number,
  lengthWord: number,
): Uint32Array {
  if (graphemes.length === 0) return emptyGraphemes
  let start = graphemes.length
  let end = 0
  for (let offset = 0; offset < words.length; offset += cellWords) {
    const length = words[offset + lengthWord]!
    if (length === 0) continue
    start = Math.min(start, words[offset + startWord]!)
    end = Math.max(end, words[offset + startWord]! + length)
  }
  if (end === 0) return emptyGraphemes
  // Native extraction appends each row's graphemes consecutively, in cell order.
  const owned = graphemes.slice(start, end)
  for (let offset = 0; offset < words.length; offset += cellWords) {
    if (words[offset + lengthWord] === 0) continue
    words[offset + startWord]! -= start
  }
  return owned
}
