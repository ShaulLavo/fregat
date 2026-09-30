// Rebuilds the vendored dictionaries and THIRD_PARTY_NOTICES. Run by hand when a source is bumped:
// `bun run build:dictionaries`. The sources are installed into a scratch directory, so none of them
// becomes a dependency of the package.
import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { gunzipSync, gzipSync } from 'node:zlib'
import {
  buildTrie,
  decodeTrie,
  type ITrie,
  parseDictionaryLines,
  serializeTrie,
} from 'cspell-trie-lib'

const SOURCES = {
  '@cspell/dict-en_us': '4.4.40',
  '@cspell/dict-software-terms': '5.4.5',
  'cspell-trie-lib': '10.3.4',
  'dictionary-en-gb': '3.0.0',
  'hunspell-reader': '10.3.4',
} as const

type HunspellReader = { seqWords(): Iterable<string> }
type HunspellModule = {
  readonly IterableHunspellReader: {
    createFromFiles(aff: string, dic: string): Promise<HunspellReader>
  }
}

const packageDir = fileURLToPath(new URL('..', import.meta.url))
const outputDir = path.join(packageDir, 'src/dictionaries')
const work = await mkdtemp(path.join(process.env.TMPDIR ?? tmpdir(), 'spellcheck-dictionaries-'))

try {
  await installSources()
  await buildDictionaries()
  await writeNotices()
} finally {
  await rm(work, { recursive: true, force: true })
}

async function installSources(): Promise<void> {
  const manifest = { private: true, dependencies: SOURCES }
  await writeFile(path.join(work, 'package.json'), JSON.stringify(manifest))
  const install = spawnSync('bun', ['install', '--no-save'], { cwd: work, stdio: 'inherit' })
  if (install.status !== 0) throw new Error('Installing the dictionary sources failed')
}

async function buildDictionaries(): Promise<void> {
  const us = decodeTrie(
    new Uint8Array(gunzipSync(await readFile(source('@cspell/dict-en_us/en_US.trie.gz')))),
  )

  const extension = await readJson(source('@cspell/dict-en_us/cspell-ext.json'))
  const information = extension.dictionaryDefinitions[0]?.dictionaryInformation
  if (!information) throw new Error('@cspell/dict-en_us has no dictionaryInformation')
  await writeFile(
    path.join(outputDir, 'suggestion-weights.json'),
    `${JSON.stringify(information, null, 2)}\n`,
  )

  const british = await britishOnlyWords(us)
  const terms = gunzipSync(
    await readFile(source('@cspell/dict-software-terms/dict/softwareTerms.txt.gz')),
  )
  const termLines = terms
    .toString('utf8')
    .split('\n')
    .filter((line) => !/\d/.test(line))

  // One trie: a suggestion walk costs about the same over a small trie as over a large one, so three
  // tries would triple it. en_US's stored forms go in verbatim; the additions are parsed the way
  // cspell-tools parses a word list, which adds their case-insensitive forms.
  const merged = buildTrie([...us.words(), ...parseDictionaryLines([...british, ...termLines])])
  const text = [...serializeTrie(merged.root, { base: 32, version: 3 })].join('')
  const compressed = gzipSync(text, { level: 9 })
  await writeFile(path.join(outputDir, 'english.trie.gz'), compressed)
  console.log(
    `english.trie.gz: ${british.length} en_GB-only words, ${compressed.length} bytes gzip`,
  )
}

/** The en_GB words en_US lacks; everything else en_GB holds is already accepted. */
async function britishOnlyWords(us: ITrie): Promise<readonly string[]> {
  const hunspell = (await import(sourceUrl('hunspell-reader/dist/index.js'))) as HunspellModule
  const reader = await hunspell.IterableHunspellReader.createFromFiles(
    source('dictionary-en-gb/index.aff'),
    source('dictionary-en-gb/index.dic'),
  )
  const words = new Set<string>()
  for (const word of reader.seqWords()) {
    if (/\d/.test(word) || us.hasWord(word, true)) continue
    words.add(word)
  }
  return [...words].toSorted()
}

async function writeNotices(): Promise<void> {
  const usReadme = await readFile(
    source('@cspell/dict-en_us/src/hunspell/README_en_US-large.txt'),
    'utf8',
  )
  const gbLicense = await readFile(source('dictionary-en-gb/license'), 'utf8')
  const sections = [
    'THIRD-PARTY NOTICES for @singapore-editor/spellcheck',
    'src/dictionaries/english.trie.gz is built by scripts/build-dictionaries.ts from the sources below.',
    notice(
      'cspell-trie-lib (runtime dependency) and the trie format',
      await readFile(source('cspell-trie-lib/LICENSE'), 'utf8'),
    ),
    notice(
      'english.trie.gz (US words) and suggestion-weights.json: @cspell/dict-en_us',
      await readFile(source('@cspell/dict-en_us/LICENSE'), 'utf8'),
    ),
    notice('en_US word list: SCOWL (en_US-large)', copyrightSection(usReadme)),
    notice(
      'english.trie.gz (British words): SCOWL en_GB Hunspell dictionary (dictionary-en-gb)',
      copyrightSection(gbLicense),
    ),
    notice(
      'english.trie.gz (software terms): @cspell/dict-software-terms',
      await readFile(source('@cspell/dict-software-terms/LICENSE'), 'utf8'),
    ),
  ]
  await writeFile(path.join(packageDir, 'THIRD_PARTY_NOTICES'), `${sections.join('\n\n')}\n`)
}

function notice(title: string, text: string): string {
  return `${'='.repeat(78)}\n${title}\n${'='.repeat(78)}\n\n${text.trim()}`
}

// SCOWL's readmes put every copyright it carries (Atkinson, Ispell BSD, WordNet, …) under this heading.
function copyrightSection(text: string): string {
  const start = text.indexOf('COPYRIGHT, SOURCES, and CREDITS:')
  if (start < 0) throw new Error('SCOWL copyright heading not found')
  return text.slice(start)
}

function source(relative: string): string {
  return path.join(work, 'node_modules', relative)
}

function sourceUrl(relative: string): string {
  return pathToFileURL(source(relative)).href
}

async function readJson(file: string): Promise<{
  readonly dictionaryDefinitions: readonly { readonly dictionaryInformation: unknown }[]
}> {
  const text = await readFile(file, 'utf8')
  // cspell-ext.json carries line comments.
  return JSON.parse(text.replace(/^\s*\/\/.*$/gm, ''))
}
