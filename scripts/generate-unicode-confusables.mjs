import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'

// VS Code's strings.ts stores the generated Unicode comparison pairs by locale.
const sourcePath = process.argv[2]
assert(sourcePath, 'Pass the path to VS Code src/vs/base/common/strings.ts')
const source = readFileSync(sourcePath, 'utf8').split('export class AmbiguousCharacters')[1]
const encoded = source?.match(/JSON.parse\(\s*'(.+?)'\s*\)/)?.[1]
assert(encoded, 'AmbiguousCharacters data was not found')
const buckets = JSON.parse(encoded.replaceAll('\\"', '"'))
const entries = [...buckets._common, ...buckets._default]
assert.equal(entries.length % 2, 0)
const pairs = []
for (let index = 0; index < entries.length; index += 2) {
  pairs.push([entries[index], entries[index + 1]])
}
const destination = new URL(
  '../apps/web/src/features/editor/utils/unicode-confusables.json',
  import.meta.url,
)
writeFileSync(destination, `${JSON.stringify(Object.fromEntries(pairs), null, 2)}\n`)
