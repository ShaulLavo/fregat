import { useEffect, useState } from 'react'
import { CompilerChild } from './compiler-child'

export type CompilerControls = {
  tick(): void
  label(value: string): void
}

export function CompilerProbe({
  ready,
  record,
}: {
  ready(controls: CompilerControls): void
  record(): void
}) {
  const [tick, setTick] = useState(0)
  const [label, setLabel] = useState('alpha')
  useEffect(() => {
    ready({ tick: () => setTick((value) => value + 1), label: setLabel })
  }, [ready])
  return (
    <box flexDirection='column'>
      <text>tick:{tick}</text>
      <CompilerChild label={label} record={record} />
    </box>
  )
}
