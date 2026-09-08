import { resolveRenderLib, type WidthMethod } from '@opentui/core'

export const viewerGutterWidth = 7

export function viewerTextWidth(text: string, widthMethod: WidthMethod) {
  const lib = resolveRenderLib()
  const encoded = lib.encodeUnicode(text.replaceAll('\t', '    '), widthMethod)
  if (!encoded) return 0
  try {
    return encoded.data.reduce((width, character) => width + character.width, 0)
  } finally {
    lib.freeUnicode(encoded)
  }
}
