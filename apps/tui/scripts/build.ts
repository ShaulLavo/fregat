import path from 'node:path'

const root = path.resolve(import.meta.dirname, '..')
const result = await Bun.build({
  entrypoints: [path.join(root, 'src/main.tsx')],
  outdir: path.join(root, 'dist'),
  tsconfig: path.join(root, 'tsconfig.json'),
  target: 'bun',
  packages: 'external',
  reactCompiler: true,
  // OpenTUI is interactive; Bun otherwise selects SSR for this target and removes state hooks.
  reactCompilerOutputMode: 'client',
  throw: false,
})

for (const log of result.logs) process.stderr.write(`${log}\n`)
if (!result.success) process.exitCode = 1
