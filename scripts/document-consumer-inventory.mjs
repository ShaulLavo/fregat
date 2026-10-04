import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'docs/document-contributions/consumer-inventory.tsv')
const patterns = {
  publish: String.raw`this\.publish\(|private publish\(|\bemitChange\(|this\.changes\.fire\(|notifyChangeWithTiming\(|sessionOptions\.onChange\?\.\(`,
  subscribe: String.raw`[bB]uffer\)?\??\.subscribe\(|handleEditorChange\??\.?\(|viewContributions\.notify\(|subscribeDocumentChanges|onDidChangeContent`,
  session: String.raw`\bcreateSession\b|\bcreateSyntaxSession\b|\bcreateHighlighterSession\b|borrow(Structural|Highlighter)\(|createEditorDocumentAnalysis\(|createEditorPreparedDocument\(|setEditorSyntaxSessionFactory|new (TreeSitterSyntaxSession|ShikiWorkerHighlighterSession|MinimapWorkerClient|Worker)\(|createLanguageServerDocument\(|new LanguageServerDocument\(|createTypeScriptLanguageServer`,
  message: String.raw`\.postMessage\(|type: '(open|edit|parse|queryRange|openDocument|replaceDocument|applyEdit|applyEdits|disposeDocument|runtimeBarrier)'|textDocument/did(Open|Change|Close|Save)`,
  materialize: String.raw`materialize(FullText|PieceTableFullText)\(|\.readRange\(|readPieceTableTextRange\(|forEachTextChunk\(|streamPieceTableTextChunks\(|forEachTextInRange\(|diffPieceTableSnapshots\(|createTextDiff\(|textSnapshotEqualsText\(|pieceTableSnapshotsHaveSameText\(|\.getText\(\)|debugPieceTable\(|forEachBufferSpan\(`,
  cursor: String.raw`changesSinceDocumentSyncPoint\(|getDocumentSyncPoint\(|getCurrentDocumentSnapshot\(|\.changesSince\(|changesBetween\(`,
  sourceHistory: String.raw`private (readonly )?(snapshot|syncPoint|workerDocumentState|structuralDispatchPoint|highlightDispatchPoint|parsedPoint|elsewhereSyncPoint|queuedRevision|rangeRevision|snapshotVersion|parsedSnapshotVersion|sourceDocumentEpochs|sentSourceChunkLengths|latestDescriptors|sourceChunkRetention|sourceCache|documentSources)\s*(:|=)|#(entries|point):|(const|let) (syncPoint|syncPointsByTextVersion|sourceOwners|sourceCache|documentSources|documentCaches|markdownDocuments|documentTasks)\b|const documents = new Map|composeSkippedChanges\(|incrementalEditsForChange\(|createSyntaxTextEdits\(|createTreeSitterSourceDescriptor\(|(invalidate|dispose|retire)Document\(`,
  privateImport: String.raw`from ['"](\.\./)+(editor|tree-sitter|minimap|lsp|lsp-plugin|diff)/src|@singapore-editor/[a-z-]+/(src|dist|internal)/|@singapore-editor/core/debug|from ['"][^'"]*/dist/`,
}
const roots = ['editor/packages', 'editor/examples', 'apps', 'packages']
const sources = readSources()

function readSources() {
  const files = execFileSync('git', ['ls-files', '--cached', '-z', '--', ...roots], {
    cwd: root,
    encoding: 'utf8',
  })
    .split('\0')
    .filter(isSource)
    .sort(sourceOrder)
  return files.map((file) => ({
    file,
    lines: readFileSync(resolve(root, file), 'utf8').split('\n'),
  }))
}

function isSource(file) {
  if (!/\.(ts|tsx|js|jsx|mjs)$/.test(file)) return false
  if (/\.(test|browser)\./.test(file)) return false
  return !/(^|\/)(node_modules|dist|test|tests|bench|e2e)(\/|$)/.test(file)
}

function sourceOrder(left, right) {
  const leftRoot = roots.findIndex((directory) => left.startsWith(`${directory}/`))
  const rightRoot = roots.findIndex((directory) => right.startsWith(`${directory}/`))
  if (leftRoot !== rightRoot) return leftRoot - rightRoot
  const leftParts = left.split('/')
  const rightParts = right.split('/')
  for (let index = 0; index < Math.min(leftParts.length, rightParts.length); index++) {
    if (leftParts[index] === rightParts[index]) continue
    return leftParts[index] < rightParts[index] ? -1 : 1
  }
  return leftParts.length - rightParts.length
}

function ownership(file) {
  if (file.startsWith('editor/packages/textbuffer/')) return 'core mutation'
  if (
    /editor\/packages\/editor\/src\/(documentSession|historySerialization|editor\/editChain)/.test(
      file,
    )
  )
    return 'core mutation'
  if (/editor\/packages\/(tree-sitter|lsp|lsp-plugin|typescript-lsp|diff)\//.test(file))
    return 'domain adapter'
  if (/editor\/packages\/editor\/src\/shiki\//.test(file)) return 'domain adapter'
  if (/editor\/packages\/(minimap|highlighting)\//.test(file)) return 'document contribution'
  if (
    /editor\/packages\/editor\/src\/editor\/(documentAnalysis|syntaxController|preparedDocument|snippetTokensFeature)/.test(
      file,
    )
  )
    return 'document contribution'
  if (file.startsWith('editor/')) return 'view presentation'
  if (/apps\/(server|tui)\/src\/.*lsp|result-syntax-(cache|plugin)/.test(file))
    return 'domain adapter'
  if (file.startsWith('apps/server/')) return 'host transaction policy'
  if (file.startsWith('packages/contracts/')) return 'host transaction policy'
  if (
    /features\/editor\/state\/|features\/workspace\/state\/|lib\/document-symbols|lib\/file-snapshot|features\/settings\/state\//.test(
      file,
    )
  )
    return 'host transaction policy'
  return 'view presentation'
}

function migration(file, category) {
  if (
    /editor\/packages\/editor\/src\/(editor\.ts|public\/testing)/.test(file) &&
    category === 'session'
  )
    return '2'
  if (/editor\/packages\/(tree-sitter|highlighting)\//.test(file)) return '2'
  if (
    /editor\/packages\/editor\/src\/(shiki|syntax|editor\/(documentAnalysis|syntaxController|preparedDocument|snippetTokensFeature|runtime))/.test(
      file,
    )
  )
    return '2'
  if (
    /editor\/packages\/diff\/src\/diffSyntax|result-syntax-(cache|plugin)|features\/editor\/utils\/prepared-document/.test(
      file,
    )
  )
    return '2'
  if (/editor\/packages\/editor\/src\/plugins/.test(file) && category === 'session') return '2'
  if (file.startsWith('editor/packages/minimap/')) return '3'
  if (
    /editor\/packages\/(lsp|lsp-plugin|typescript-lsp)\/|language-server|document-symbols|apps\/server\/src\/.*lsp/.test(
      file,
    )
  )
    return '4'
  if (
    /editor\/packages\/find\/|mergeConflictPlugin|semanticToken|semantic-token|editorDiffPlugin/.test(
      file,
    )
  )
    return '5'
  return 'preserve'
}

function notes(file, category) {
  if (file.startsWith('editor/examples/'))
    return 'Example or benchmark caller; preserve supported simple construction'
  if (/spellcheck\//.test(file))
    return 'Word-service worker; carries words, outside document source synchronization'
  if (/apps\/tui\//.test(file))
    return 'Terminal viewer owns separate text; outside Editor buffer runtime'
  if (/demo-entry|demo\/state\/orchestration|native-watch-host/.test(file))
    return 'Host/demo messaging; outside document source synchronization'
  if (
    /orchestration\/|features\/chat\/|chat\/commands|command-summary|orchestration-commands/.test(
      file,
    )
  )
    return 'Agent session or command contract; outside document source synchronization'
  if (category === 'privateImport')
    return 'Core-owned storage access stays; external debug/source access needs the unit 2 reader'
  if (category === 'sourceHistory')
    return 'Audit generic source progress separately from parser, projection, protocol, or view state'
  if (category === 'session')
    return 'Includes declarations and borrowing; match count is not live session count'
  return 'Source match; ownership and deletion decisions are in baseline-and-inventory.md'
}

function scan(category, pattern) {
  const expression = new RegExp(pattern)
  return sources.flatMap((source) => scanLines(category, expression, source))
}

function scanLines(category, expression, { file, lines }) {
  const matches = []
  for (const [index, text] of lines.entries()) {
    if (!expression.test(text)) continue
    const line = `${file}:${index + 1}:${text}`
    if (relevantMatch(category, line)) matches.push(row(category, line))
  }
  return matches
}

function relevantMatch(category, line) {
  if (category !== 'publish') return true
  if (!/this\.publish\(|private publish\(/.test(line)) return true
  return line.startsWith('editor/packages/editor/src/documentSession.ts:')
}

function row(category, line) {
  const [file, position, ...source] = line.split(':')
  const repo = file.startsWith('editor/') ? 'Editor' : 'Platform'
  const text = source.join(':').trim().replaceAll('\t', ' ')
  return [
    repo,
    category,
    ownership(file),
    file,
    position,
    text,
    migration(file, category),
    notes(file, category),
  ].join('\t')
}

const rows = Object.entries(patterns).flatMap(([category, pattern]) => scan(category, pattern))
const inventory = ['repo\tcategory\towner\tfile\tline\ttext\tunit\tnote', ...rows].join('\n') + '\n'
const mode = process.argv[2]
if (mode === '--write') writeFileSync(output, inventory)
else if (mode === '--check') {
  if (readFileSync(output, 'utf8') !== inventory) {
    process.stderr.write(
      'Consumer inventory changed. Review source matches and run with --write.\n',
    )
    process.exit(1)
  }
} else if (mode === undefined) process.stdout.write(inventory)
else {
  process.stderr.write('Usage: node scripts/document-consumer-inventory.mjs [--write|--check]\n')
  process.exit(1)
}
const counts = Object.fromEntries(
  Object.keys(patterns).map((category) => [
    category,
    rows.filter((line) => line.split('\t')[1] === category).length,
  ]),
)
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim()
process.stderr.write(`${JSON.stringify({ revision, rows: rows.length, counts })}\n`)
