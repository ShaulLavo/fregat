/** A code fence that outruns any backtick run inside the quoted lines. */
export function markdownFence(lines: readonly string[]): string {
  const runs = lines.flatMap((line) => [...line.matchAll(/`+/g)].map((match) => match[0].length))

  return '`'.repeat(Math.max(3, Math.max(0, ...runs) + 1))
}
