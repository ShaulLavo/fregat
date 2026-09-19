import { parseArgs } from 'node:util'
import { omarchyBundleArchive } from '../../apps/server/src/themes/omarchy-bundle'

const { values } = parseArgs({ options: { theme: { type: 'string' }, out: { type: 'string' } } })
const { archive, report } = await omarchyBundleArchive(values.theme)
if (values.out) await Bun.write(values.out, `${JSON.stringify(archive, null, 2)}\n`)
else process.stdout.write(`${JSON.stringify(archive, null, 2)}\n`)
process.stderr.write(`${report.join('\n')}\n`)
