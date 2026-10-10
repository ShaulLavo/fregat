import { fileURLToPath } from 'node:url'
import { checkInternalLinks } from './links'
import { startCapture } from './capture'

const root = fileURLToPath(new URL('../', import.meta.url))
const stopCapture = await startCapture()
try {
  for (const command of [
    ['bun', 'run', 'typecheck'],
    ['bun', 'run', 'astro', 'build'].concat(process.argv.slice(2)),
  ]) {
    const child = Bun.spawn(command, { cwd: root, stdout: 'inherit', stderr: 'inherit' })
    const code = await child.exited
    if (code !== 0) throw new TypeError(`Site build failed with exit ${code}`)
  }
} finally {
  await stopCapture()
}
const baseIndex = process.argv.indexOf('--base')
const base = baseIndex === -1 ? '/' : process.argv[baseIndex + 1]
const result = await checkInternalLinks(fileURLToPath(new URL('../dist/', import.meta.url)), base)
if (result.problems.length) {
  console.error(result.problems.join('\n'))
  process.exit(1)
}
console.log(
  `Checked ${result.checked} rendered internal links and anchors across ${result.pages} pages.`,
)
