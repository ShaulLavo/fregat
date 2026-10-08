import { readFile, readdir, mkdir, writeFile, access, stat } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync, brotliCompressSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { build } from 'vite'
import { editors } from './protocol.mjs'
import { fullDocumentTransform } from './full-document.mjs'
import { sourceIdentity } from './provenance.mjs'

export const root = dirname(fileURLToPath(import.meta.url))
export const output = resolve(root, 'dist')

async function aliases() {
  const result = []
  for (const folder of [
    'editor',
    'textbuffer',
    'tree-sitter',
    'tree-sitter-languages',
    '../../hotkeys/packages/hotkeys',
  ]) {
    const directory = resolve(root, '../../packages', folder)
    const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'))
    for (const [key, target] of Object.entries(manifest.exports)) {
      const runtime = typeof target === 'string' ? target : target.import
      if (!runtime.startsWith('./dist/')) continue
      let source = runtime.replace('./dist/', './src/').replace(/\.js$/, '.ts')
      if (source.endsWith('.ts') && !source.includes('*')) {
        try {
          await access(resolve(directory, source))
        } catch {
          source += 'x'
        }
      }
      result.push({
        find: new RegExp(
          '^' +
            (manifest.name + (key === '.' ? '' : key.slice(1)))
              .replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
              .replace('\\*', '(.*)') +
            '$',
        ),
        replacement: resolve(directory, source.replace('*', '$1')),
      })
    }
  }
  return result.sort((a, b) => b.find.source.length - a.find.source.length)
}

function minimalEntry(editor, highlighted) {
  const entries = {
    singapore: `import '@singapore-editor/core/style.css'; import { Editor } from '@singapore-editor/core/editor';
      ${highlighted ? "import { typeScript } from '@singapore-editor/tree-sitter-languages';" : ''}
      const editor = new Editor(document.body, { ${highlighted ? 'plugins: [typeScript()]' : ''} });
      ${highlighted ? "editor.setText('', { languageId: 'typescript' });" : ''}`,
    codemirror: `import { EditorView } from '@codemirror/view'; import { EditorState } from '@codemirror/state';
      ${highlighted ? "import { basicSetup } from 'codemirror'; import { javascript } from '@codemirror/lang-javascript';" : ''}
      new EditorView({ parent: document.body, state: EditorState.create({ extensions: [${highlighted ? 'basicSetup, javascript({ typescript: true })' : ''}] }) });`,
    monaco: `import * as monaco from 'monaco-editor/editor/editor.api';
      import Worker from 'monaco-editor/editor/editor.worker?worker';
      ${highlighted ? "import 'monaco-editor/languages/definitions/typescript/register';" : ''}
      self.MonacoEnvironment = { getWorker: () => new Worker() };
      monaco.editor.create(document.body, { language: '${highlighted ? 'typescript' : 'plaintext'}' });`,
  }
  return entries[editor]
}

export async function buildAll({ fullDocument = false } = {}) {
  const sourceSha256 = await sourceIdentity(root)
  const sizes = []
  const template = await readFile(resolve(root, 'page.html'), 'utf8')
  const page = await readFile(resolve(root, 'page.js'), 'utf8')
  for (const editor of editors) {
    for (const highlighted of [false, true]) {
      const id = `${editor}-${highlighted ? 'typescript' : 'core'}`
      const outDir = resolve(output, id)
      for (const minimal of [true, false]) {
        const destination = minimal ? resolve(output, `bundle-${id}`) : outDir
        await build({
          root,
          configFile: false,
          logLevel: 'warn',
          base: './',
          publicDir: false,
          resolve: { alias: await aliases() },
          plugins: [
            {
              name: 'compare-entry',
              enforce: 'pre',
              resolveId(id) {
                if (id === 'virtual:compare') return '\0compare'
              },
              load(id) {
                if (id === '\0compare')
                  return (minimal ? minimalEntry(editor, highlighted) : page)
                    .replace("'ACTOR'", JSON.stringify(resolve(root, `${editor}.js`)))
                    .replace("'FIXTURE'", JSON.stringify(resolve(root, 'fixture.mjs')))
                    .replace(
                      "'./output-proof.mjs'",
                      JSON.stringify(resolve(root, 'output-proof.mjs')),
                    )
                    .replaceAll('HIGHLIGHTED', JSON.stringify(highlighted))
              },
              transform(code, id) {
                if (fullDocument) {
                  const transformed = fullDocumentTransform(code, id)
                  if (transformed !== undefined) return transformed
                }
                if (highlighted || !id.endsWith(`${editor}.js`)) return
                return code
                  .replace(
                    /^import.*(?:tree-sitter-languages|lang-javascript|typescript.contribution|typescript\/register|from 'codemirror').*\n/gm,
                    '',
                  )
                  .replace(/\[basicSetup\]/g, '[]')
                  .replace(/\[typeScript\(\)\]/g, '[]')
                  .replace(/\[javascript\(\{ typescript: true \}\)\]/g, '[]')
              },
            },
          ],
          build: {
            outDir: destination,
            emptyOutDir: true,
            assetsInlineLimit: 0,
            target: 'es2023',
            rollupOptions: { input: 'virtual:compare', output: { entryFileNames: 'entry.js' } },
          },
          worker: {
            format: 'es',
            plugins: () =>
              fullDocument
                ? [
                    {
                      name: 'full-document-worker-probe',
                      enforce: 'pre',
                      transform: fullDocumentTransform,
                    },
                  ]
                : [],
          },
        })
      }
      const files = []
      for (const file of (
        await readdir(resolve(output, `bundle-${id}`), { recursive: true })
      ).sort()) {
        if (!(await stat(resolve(output, `bundle-${id}`, file))).isFile() || file.endsWith('.map'))
          continue
        const bytes = await readFile(resolve(output, `bundle-${id}`, file))
        files.push({
          file,
          kind: file.split('.').at(-1),
          bytes: bytes.length,
          gzip: gzipSync(bytes, { level: 9 }).length,
          brotli: brotliCompressSync(bytes).length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
        })
      }
      const styles = (await readdir(outDir, { recursive: true }))
        .filter((file) => file.endsWith('.css'))
        .map((file) => `<link rel="stylesheet" href="./${file}">`)
        .join('\n')
      await writeFile(
        resolve(outDir, 'index.html'),
        template.replace('<div id="editor">', `${styles}\n<div id="editor">`),
      )
      sizes.push({
        id,
        files,
        totals: Object.fromEntries(
          ['bytes', 'gzip', 'brotli'].map((key) => [
            key,
            files.reduce((sum, file) => sum + file[key], 0),
          ]),
        ),
      })
    }
  }
  if (sourceSha256 !== (await sourceIdentity(root)))
    throw new RangeError('Benchmark sources changed during build')
  await mkdir(output, { recursive: true })
  await writeFile(resolve(output, 'mode.json'), JSON.stringify({ fullDocument, sourceSha256 }))
  await writeFile(resolve(output, 'bundles.json'), JSON.stringify(sizes, null, 2))
  return sizes
}

if (process.argv[1] === fileURLToPath(import.meta.url))
  await buildAll({ fullDocument: process.argv.includes('--full-document') })
