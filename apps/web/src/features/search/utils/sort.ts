import { compareValues as compareRawStrings } from '@workspace/utils/compare'
const fileNameCollator = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
})
const PATH_COMPONENT_CACHE_LIMIT = 4096
const PATH_PARTS_CACHE_LIMIT = 4096
const FILE_NAME_COMPARE_CACHE_LIMIT = 4096
const ASCII_UPPERCASE_A = 65
const ASCII_UPPERCASE_Z = 90
const ASCII_LOWERCASE_OFFSET = 32
const ASCII_ZERO = 48
const ASCII_NINE = 57
const ASCII_DOT = 46
const ASCII_HYPHEN = 45
const ASCII_SPACE = 32
const ASCII_LOWERCASE_A = 97
const ASCII_LOWERCASE_Z = 122
const fileNameCompareCache = new Map<string, number>()
const pathComponentLowerCaseCache = new Map<string, string>()
const pathPartsCache = new Map<string, readonly string[]>()

export function compareSearchPaths(left: string, right: string) {
  const leftParts = pathParts(left)
  const rightParts = pathParts(right)

  for (let index = 0; ; index += 1) {
    const leftPart = leftParts[index] ?? ''
    const rightPart = rightParts[index] ?? ''
    const leftIsFileName = index === leftParts.length - 1
    const rightIsFileName = index === rightParts.length - 1

    if (leftIsFileName && rightIsFileName) {
      return compareSearchFileNames(leftPart, rightPart)
    }
    if (leftIsFileName) return -1
    if (rightIsFileName) return 1

    const result = comparePathComponents(leftPart, rightPart)
    if (result !== 0) return result
  }
}

export function compareSearchFileNames(left: string, right: string) {
  if (left === right) return 0

  const fastResult = compareFastSearchFileNames(left, right)
  if (fastResult !== null) return fastResult

  return compareSearchFileNamesWithCollator(left, right)
}

function compareSearchFileNamesWithCollator(left: string, right: string) {
  const cached = cachedFileNameComparison(left, right)
  if (cached !== null) return cached

  const result = fileNameCollator.compare(left, right)
  const comparison = result !== 0 ? result : compareRawStrings(left, right)
  cacheFileNameComparison(left, right, comparison)

  return comparison
}

function compareFastSearchFileNames(left: string, right: string) {
  let leftIndex = 0
  let rightIndex = 0

  while (leftIndex < left.length && rightIndex < right.length) {
    const leftCode = left.charCodeAt(leftIndex)
    const rightCode = right.charCodeAt(rightIndex)
    if (!isFastFileNameCode(leftCode)) return null
    if (!isFastFileNameCode(rightCode)) return null

    if (isAsciiDigit(leftCode) && isAsciiDigit(rightCode)) {
      const leftEnd = asciiDigitRunEnd(left, leftIndex)
      const rightEnd = asciiDigitRunEnd(right, rightIndex)
      const result = compareAsciiDigitRuns(left, leftIndex, leftEnd, right, rightIndex, rightEnd)
      if (result !== 0) return result

      leftIndex = leftEnd
      rightIndex = rightEnd
      continue
    }

    const normalizedLeft = asciiLowerCode(leftCode)
    const normalizedRight = asciiLowerCode(rightCode)
    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft < normalizedRight ? -1 : 1
    }

    leftIndex += 1
    rightIndex += 1
  }

  if (!hasOnlyFastFileNameCodes(left, leftIndex)) return null
  if (!hasOnlyFastFileNameCodes(right, rightIndex)) return null
  if (leftIndex < left.length) return 1
  if (rightIndex < right.length) return -1

  return compareRawStrings(left, right)
}

function comparePathComponents(left: string, right: string) {
  const fastResult = compareAsciiPathComponents(left, right)
  if (fastResult !== null) return fastResult

  const normalizedLeft = pathComponentLowerCase(left)
  const normalizedRight = pathComponentLowerCase(right)
  if (normalizedLeft === normalizedRight) return 0

  return normalizedLeft < normalizedRight ? -1 : 1
}

function compareAsciiPathComponents(left: string, right: string) {
  const length = Math.min(left.length, right.length)

  for (let index = 0; index < length; index += 1) {
    const leftCode = left.charCodeAt(index)
    const rightCode = right.charCodeAt(index)
    if (!isAscii(leftCode)) return null
    if (!isAscii(rightCode)) return null

    const normalizedLeft = asciiLowerCode(leftCode)
    const normalizedRight = asciiLowerCode(rightCode)
    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft < normalizedRight ? -1 : 1
    }
  }

  if (!hasOnlyAsciiCodes(left, length)) return null
  if (!hasOnlyAsciiCodes(right, length)) return null
  if (left.length === right.length) return 0

  return left.length < right.length ? -1 : 1
}

function compareAsciiDigitRuns(
  left: string,
  leftStart: number,
  leftEnd: number,
  right: string,
  rightStart: number,
  rightEnd: number,
) {
  const leftSignificantStart = firstSignificantDigitIndex(left, leftStart, leftEnd)
  const rightSignificantStart = firstSignificantDigitIndex(right, rightStart, rightEnd)
  const leftLength = leftEnd - leftSignificantStart
  const rightLength = rightEnd - rightSignificantStart
  if (leftLength !== rightLength) return leftLength < rightLength ? -1 : 1

  for (let offset = 0; offset < leftLength; offset += 1) {
    const leftCode = left.charCodeAt(leftSignificantStart + offset)
    const rightCode = right.charCodeAt(rightSignificantStart + offset)
    if (leftCode !== rightCode) return leftCode < rightCode ? -1 : 1
  }

  return 0
}

function firstSignificantDigitIndex(value: string, start: number, end: number) {
  let index = start

  while (index < end && value.charCodeAt(index) === ASCII_ZERO) {
    index += 1
  }

  return index
}

function asciiDigitRunEnd(value: string, start: number) {
  let index = start

  while (index < value.length && isAsciiDigit(value.charCodeAt(index))) {
    index += 1
  }

  return index
}

function hasOnlyFastFileNameCodes(value: string, start: number) {
  for (let index = start; index < value.length; index += 1) {
    if (!isFastFileNameCode(value.charCodeAt(index))) return false
  }

  return true
}

function hasOnlyAsciiCodes(value: string, start: number) {
  for (let index = start; index < value.length; index += 1) {
    if (!isAscii(value.charCodeAt(index))) return false
  }

  return true
}

function pathComponentLowerCase(value: string) {
  const cached = pathComponentLowerCaseCache.get(value)
  if (cached !== undefined) return cached

  const normalized = value.toLocaleLowerCase()
  setBoundedCache(pathComponentLowerCaseCache, value, normalized, PATH_COMPONENT_CACHE_LIMIT)

  return normalized
}

function pathParts(path: string) {
  const cached = pathPartsCache.get(path)
  if (cached !== undefined) return cached

  const parts = path.split('/')
  setBoundedCache(pathPartsCache, path, parts, PATH_PARTS_CACHE_LIMIT)

  return parts
}

function cachedFileNameComparison(left: string, right: string) {
  const key = fileNameCompareCacheKey(left, right)
  const cached = fileNameCompareCache.get(key)
  if (cached !== undefined) return cached

  const reverseKey = fileNameCompareCacheKey(right, left)
  const reverseCached = fileNameCompareCache.get(reverseKey)
  if (reverseCached !== undefined) return -reverseCached

  return null
}

function cacheFileNameComparison(left: string, right: string, comparison: number) {
  setBoundedCache(
    fileNameCompareCache,
    fileNameCompareCacheKey(left, right),
    comparison,
    FILE_NAME_COMPARE_CACHE_LIMIT,
  )
}

function fileNameCompareCacheKey(left: string, right: string) {
  return `${left}\u0000${right}`
}

function asciiLowerCode(code: number) {
  if (code < ASCII_UPPERCASE_A) return code
  if (code > ASCII_UPPERCASE_Z) return code

  return code + ASCII_LOWERCASE_OFFSET
}

function isFastFileNameCode(code: number) {
  if (isAsciiDigit(code)) return true
  if (code >= ASCII_UPPERCASE_A && code <= ASCII_UPPERCASE_Z) return true
  if (code >= ASCII_LOWERCASE_A && code <= ASCII_LOWERCASE_Z) return true
  if (code === ASCII_DOT) return true
  if (code === ASCII_HYPHEN) return true

  return code === ASCII_SPACE
}

function isAsciiDigit(code: number) {
  return code >= ASCII_ZERO && code <= ASCII_NINE
}

function isAscii(code: number) {
  return code <= 127
}

function setBoundedCache<K, V>(cache: Map<K, V>, key: K, value: V, limit: number) {
  if (cache.size >= limit) cache.clear()

  cache.set(key, value)
}
