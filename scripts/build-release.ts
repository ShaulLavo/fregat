import { parseArgs } from 'node:util'
import { buildPortableRelease } from './deploy/build-release'
import { scriptFailureText } from './structured-errors'

const usage = `Usage: bun run build-release [options]

  Build a self-contained release for this OS and architecture.
  --output=<directory>  New output directory; defaults to a unique OS temporary directory.
  --base=<route>        Application base path; defaults to /. Match the installation route.
  --reason=<text>       Record the build's purpose.
  --help`

export async function main(args = Bun.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      output: { type: 'string' },
      base: { type: 'string' },
      reason: { type: 'string' },
      help: { type: 'boolean' },
    },
    strict: true,
  })
  if (values.help) return console.log(usage)
  const release = await buildPortableRelease(values)
  console.log(`[release] built ${release.directory}`)
}

if (import.meta.main) {
  try {
    await main()
  } catch (error) {
    console.error(scriptFailureText(error))
    process.exit(1)
  }
}
