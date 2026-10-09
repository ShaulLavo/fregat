export function CompilerChild({ label, record }: { label: string; record(): void }) {
  record()
  return <text>{label}</text>
}
