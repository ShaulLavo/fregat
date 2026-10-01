import { createScriptError } from '../../structured-errors'

const LANE_NAME = /^[a-z][a-z0-9-]{0,31}$/
const HOME = /^\/home\/[a-z_][a-z0-9_-]{0,31}$/
const MEMORY_MAX = /^[1-9][0-9]{0,5}[KMG]$/

/** The lane directory: one plain name under the Pi user's home, so no argument can leave it. */
export function laneRoot(home: string, name: string) {
  if (!HOME.test(home)) {
    throw createScriptError(
      `The Pi user's home must be /home/<user>; ssh reported ${JSON.stringify(home)}.`,
    )
  }
  if (!LANE_NAME.test(name)) {
    throw createScriptError(
      `--lane must match ${LANE_NAME.source}; received ${JSON.stringify(name)}.`,
    )
  }
  return `${home}/${name}`
}

export function memoryMax(value: string) {
  if (!MEMORY_MAX.test(value)) {
    throw createScriptError(
      `--memory-max must look like 3G or 2560M; received ${JSON.stringify(value)}.`,
    )
  }
  return value
}
