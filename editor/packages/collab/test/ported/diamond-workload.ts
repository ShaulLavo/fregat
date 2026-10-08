// josephg/diamond-types @ 89ae3a0ab8d941a2885e6ec89d094bc9ce9d2922.
// src/list/old_fuzzer_tools.rs, old_make_random_change_raw;
// src/list_fuzzer_tools.rs, random_str and make_random_change.
// Adapted to Singapore ID-space edits, with scalar-index to UTF-16 translation.
// ISC, Seph Gentle and Diamond Types contributors. See ../../THIRD_PARTY_TEST_NOTICES.md.
import type { OffsetEdit } from '../../src/index'

const alphabet = [...'abc123 \n©¥½ΎΔδϠ←↯↻⇈𐆐𐆔𐆘𐆚']

export function randomChange(text: string, random: () => number) {
  const scalars = [...text]
  const choose = (bound: number) => Math.floor(random() * bound)
  const edits: OffsetEdit[] = []
  const offsetAt = (index: number) => scalars.slice(0, index).join('').length
  if (scalars.length === 0 || random() < (scalars.length < 100 ? 0.55 : 0.45)) {
    const index = choose(scalars.length + 1)
    const count = 1 + choose(2)
    const content = Array.from({ length: count }, () => alphabet[choose(alphabet.length)]!)
    const offset = offsetAt(index)
    if (count === 1 || random() < 0.5) {
      edits.push({ offset, deleteCount: 0, text: content.join('') })
    } else {
      for (const scalar of [...content].reverse())
        edits.push({ offset, deleteCount: 0, text: scalar })
    }
    scalars.splice(index, 0, ...content)
    return { edits, text: scalars.join('') }
  }
  const index = choose(scalars.length)
  const count = 1 + choose(Math.min(10, scalars.length - index))
  if (count === 1 || random() < 0.5) {
    edits.push({
      offset: offsetAt(index),
      deleteCount: scalars.slice(index, index + count).join('').length,
      text: '',
    })
  } else {
    for (let end = index + count - 1; end >= index; end--) {
      edits.push({ offset: offsetAt(end), deleteCount: scalars[end]!.length, text: '' })
    }
  }
  scalars.splice(index, count)
  return { edits, text: scalars.join('') }
}
