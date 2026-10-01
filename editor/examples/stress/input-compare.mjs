import { readInputArtifact as read, writeInputArtifact } from './input-artifacts.mjs'
import { calibrateInput, compareInput } from './input-results.mjs'
import { fail } from './errors.mjs'

const usage =
  'Usage: input-compare calibrate output.json control1.json control2.json control3.json [...] | check baseline.json candidate.json calibration.json [--allow-slowdown] [--same-build]'
const [mode, ...args] = process.argv.slice(2)

if (mode === 'calibrate') {
  if (args.length < 4 || args.some((arg) => arg.startsWith('--'))) fail(usage)
  const [output, ...paths] = args
  const calibration = calibrateInput(await Promise.all(paths.map(read)))
  await writeInputArtifact(output, calibration)
} else if (mode === 'check') {
  const allowSlowdown = args.includes('--allow-slowdown')
  const sameBuild = args.includes('--same-build')
  const paths = args.filter((arg) => arg !== '--allow-slowdown' && arg !== '--same-build')
  if (paths.length !== 3 || paths.some((arg) => arg.startsWith('--'))) fail(usage)
  const [baseline, candidate, calibration] = await Promise.all(paths.map(read))
  const result = compareInput(baseline, candidate, calibration, { allowSlowdown, sameBuild })
  console.log(JSON.stringify(result, null, 2))
  if (!result.passed) process.exitCode = 1
} else {
  fail(usage)
}
