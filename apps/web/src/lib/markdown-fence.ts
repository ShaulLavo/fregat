export function markdownFence(lines: readonly string[]): string {
  const runs = lines.flatMap((line) => Array.from(line.matchAll(/`+/g), (match) => match[0].length))

  return '`'.repeat(Math.max(3, Math.max(0, ...runs) + 1))
}
