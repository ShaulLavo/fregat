import { act, useEffect, useState } from 'react'

import { expect, test } from '../../../test/fixtures'
import { renderTui } from '../../../test/render'

type Controls = {
  tick(): void
  label(value: string): void
}

function Child({ label, record }: { label: string; record(): void }) {
  record()
  return <text>{label}</text>
}

function Probe({ ready, record }: { ready(controls: Controls): void; record(): void }) {
  const [tick, setTick] = useState(0)
  const [label, setLabel] = useState('alpha')
  useEffect(() => {
    ready({ tick: () => setTick((value) => value + 1), label: setLabel })
  }, [ready])
  return (
    <box flexDirection='column'>
      <text>tick:{tick}</text>
      <Child label={label} record={record} />
    </box>
  )
}

test('compiled terminal components reuse children and still apply state and prop changes', async () => {
  let controls: Controls | undefined
  let childRenders = 0
  const frame = await renderTui(
    <Probe
      ready={(value) => {
        controls = value
      }}
      record={() => {
        childRenders += 1
      }}
    />,
    { width: 30, height: 4, useThread: false },
  )
  try {
    expect(controls).toBeDefined()
    if (!controls) return
    const update = controls
    const initialRenders = childRenders
    await act(async () => {
      update.tick()
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('tick:1')
    expect(childRenders).toBe(initialRenders)

    await act(async () => {
      update.label('beta')
    })
    await frame.renderOnce()
    expect(frame.captureCharFrame()).toContain('beta')
    expect(frame.captureCharFrame()).not.toContain('alpha')
    expect(childRenders).toBe(initialRenders + 1)
  } finally {
    await frame.cleanup()
  }
})
