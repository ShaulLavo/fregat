import { serializeComposerMention } from '@workspace/contracts'

/** The prompt that is sent while the active-file chip shows: the text, then the file's mention. */
export function withActiveFileMention(text: string, path: string | null) {
  if (!path) return text
  const mention = serializeComposerMention(path)
  if (text.includes(mention)) return text

  return `${text}\n\n${mention}`
}
