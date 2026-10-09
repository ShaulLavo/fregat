import { registeredPresetCommandIds } from '../../scripts/generate-preset-runtime'

console.log(JSON.stringify([...registeredPresetCommandIds()].toSorted()))
