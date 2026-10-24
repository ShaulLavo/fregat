import { readFile, writeFile } from 'node:fs/promises'
import { calibrate, compare } from './results.mjs'
import { fail } from './errors.mjs'

const [mode, ...paths] = process.argv.slice(2)
const read = async (path) => JSON.parse(await readFile(path, 'utf8'))
if (mode === 'calibrate') {
  const [output, ...controls] = paths
  const calibration = calibrate(await Promise.all(controls.map(read)))
  await writeFile(output, JSON.stringify(calibration, null, 2) + '\n')
} else if (mode === 'check') {
  if (paths.length !== 3) fail('Usage: compare check baseline.json candidate.json calibration.json')
  const result = compare(...(await Promise.all(paths.map(read))))
  console.log(JSON.stringify(result, null, 2))
  if (!result.passed) process.exitCode = 1
} else {
  fail(
    'Usage: compare calibrate output.json control1.json control2.json control3.json | check baseline.json candidate.json calibration.json',
  )
}
