// Modified for Platform from Pierre. Apache-2.0; see LICENSE-pierre and UPSTREAM.md.
export interface NormalizedInputPath {
  isDirectory: boolean
  path: string
}

/**
 * Normalizes user-provided tree paths.
 * Trailing slashes explicitly mark directories; empty slash segments are ignored.
 */
export function normalizeInputPath(inputPath: string): NormalizedInputPath | null {
  const isDirectory = inputPath.endsWith('/')
  let normalizedPath = ''
  let segmentStart = -1

  for (let i = 0; i <= inputPath.length; i += 1) {
    const char = inputPath[i]
    const isSeparator = char === '/' || i === inputPath.length

    if (!isSeparator) {
      if (segmentStart === -1) {
        segmentStart = i
      }
      continue
    }

    if (segmentStart === -1) {
      continue
    }

    if (normalizedPath !== '') {
      normalizedPath += '/'
    }
    normalizedPath += inputPath.slice(segmentStart, i)
    segmentStart = -1
  }

  if (normalizedPath === '') {
    return null
  }

  return {
    isDirectory,
    path: normalizedPath,
  }
}
