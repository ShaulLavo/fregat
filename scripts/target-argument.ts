import path from 'node:path'
export function targetArgument(defaultTarget: string): string {
  const inline = process.argv.find((argument) => argument.startsWith('--target='))
  if (inline) return resolveTarget(inline.slice('--target='.length))

  const index = process.argv.indexOf('--target')
  if (index === -1) return defaultTarget

  return resolveTarget(process.argv[index + 1])
}

function resolveTarget(value: string | undefined): string {
  if (!value || value.startsWith('--')) {
    console.error('--target requires a path')
    process.exit(1)
  }

  return path.resolve(value)
}
