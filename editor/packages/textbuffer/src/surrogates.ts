export const isHighSurrogate = (code: number): boolean => code >= 0xd800 && code <= 0xdbff

export const isLowSurrogate = (code: number): boolean => code >= 0xdc00 && code <= 0xdfff

// A range that cuts a pair leaves a half behind unless the replacement text
// puts that half back. Every path that snaps a range asks these two.
export const mendsCutAtStart = (text: string): boolean => isLowSurrogate(text.charCodeAt(0))

export const mendsCutAtEnd = (text: string): boolean =>
  isHighSurrogate(text.charCodeAt(text.length - 1))

const SURROGATE = /[\ud800-\udfff]/
const SHORT_TEXT = 16

// A keystroke's text is a unit or two, where a loop beats entering the regex;
// the regex answers a one-byte string of any length without scanning it.
export const containsSurrogate = (text: string): boolean => {
  if (text.length > SHORT_TEXT) return SURROGATE.test(text)
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdfff) return true
  }
  return false
}
