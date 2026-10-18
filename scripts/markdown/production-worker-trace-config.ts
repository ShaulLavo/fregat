const CATEGORIES = [
  'toplevel',
  'devtools.timeline',
  'v8.execute',
  'blink.user_timing',
  'disabled-by-default-devtools.timeline',
  '__metadata',
]

// Explicit thread sampling avoids absent clocks on short tasks; CDP JSON remains flat.
export function productionWorkerTraceConfig() {
  const track = Buffer.concat(
    [protoBytes(1, Buffer.from('*'))].concat(
      CATEGORIES.map((category) => protoBytes(2, Buffer.from(category))),
      [protoNumber(8, 1), protoNumber(10, 0)],
    ),
  )
  const source = Buffer.concat([
    protoBytes(1, Buffer.from('track_event')),
    protoBytes(101, Buffer.concat([protoNumber(3, 1), protoBytes(5, Buffer.from('traceEvents'))])),
    protoBytes(113, track),
  ])
  return Buffer.concat([
    protoBytes(1, protoNumber(1, 65_536)),
    protoBytes(2, protoBytes(1, source)),
  ]).toString('base64')
}

function protoBytes(field: number, value: Uint8Array) {
  return Buffer.concat([varint(field * 8 + 2), varint(value.length), value])
}

function protoNumber(field: number, value: number) {
  return Buffer.concat([varint(field * 8), varint(value)])
}

function varint(value: number) {
  const bytes: number[] = []
  do {
    const byte = value % 128
    value = Math.floor(value / 128)
    bytes.push(byte | (value > 0 ? 128 : 0))
  } while (value > 0)
  return Buffer.from(bytes)
}
