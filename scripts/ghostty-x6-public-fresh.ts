import assert from 'node:assert/strict'
import { hash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, relative, resolve } from 'node:path'
import { instrumentSource } from './ghostty-x6-source-ledger.ts'

export function bindX6FreshSource(file: string, mapped: string, current: string) {
  assert.equal(mapped, current, `Exact current build input required: ${file}`)
  const sha256 = hash('sha256', current, 'hex')
  return {
    file,
    frozenSha256: sha256,
    currentSha256: sha256,
    classification: 'BYTE-EQUAL' as const,
  }
}

export function verifyX6FreshMap(mapFile: string, packageRoot: string, instrumented: boolean) {
  const map: { sources: readonly string[]; sourcesContent: readonly string[] } = JSON.parse(
    readFileSync(mapFile, 'utf8'),
  )
  assert(map.sources.length > 0)
  assert.equal(map.sources.length, map.sourcesContent.length)
  assert.equal(new Set(map.sources).size, map.sources.length)
  return map.sources.map((mappedFile, index) => {
    const source = resolve(dirname(mapFile), mappedFile)
    const current = readFileSync(source, 'utf8')
    const file = relative(packageRoot, source)
    const counted = instrumented && /^src\/(?:core|dom|term|extensions)\//.test(file)
    const expected = counted ? instrumentSource(file, current).source : current
    return {
      ...bindX6FreshSource(source, map.sourcesContent[index]!, expected),
      currentRawSha256: hash('sha256', current, 'hex'),
    }
  })
}
