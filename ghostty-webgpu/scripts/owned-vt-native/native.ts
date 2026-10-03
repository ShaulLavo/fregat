import assert from 'node:assert/strict'

export interface Cell {
  cp: number[]
  wide: number
  fg: [number, number]
  bold: boolean
}
export interface Snapshot {
  cols: number
  rows: number
  screen: number
  cursor: [number, number, boolean]
  grid: { wrap: boolean; continuation: boolean; cells: Cell[] }[]
}
export type Point = [number, number]
export type Receipt = (value: Record<string, unknown>) => void

async function* lines(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      let newline = buffer.indexOf('\n')
      while (newline >= 0) {
        yield buffer.slice(0, newline)
        buffer = buffer.slice(newline + 1)
        newline = buffer.indexOf('\n')
      }
    }
  } finally {
    reader.releaseLock()
  }
  assert.equal(buffer, '', 'native protocol ended with an incomplete record')
}

export class Native {
  private readonly process
  private readonly replies
  private readonly stderr: Promise<string>
  private readonly receipt: Receipt
  private readonly label: string

  constructor(binary: string, label: string, receipt: Receipt) {
    this.process = Bun.spawn([binary], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    this.stderr = new Response(this.process.stderr).text()
    this.replies = lines(this.process.stdout)
    this.receipt = receipt
    this.label = label
  }

  async request(command: string): Promise<unknown> {
    this.process.stdin.write(`${command}\n`)
    await this.process.stdin.flush()
    const reply = await this.replies.next()
    assert.equal(reply.done, false, 'native process ended before acknowledging the operation')
    const value: unknown = JSON.parse(reply.value!)
    this.receipt({ kind: 'native', terminal: this.label, command, value })
    return value
  }

  async create(cols: number, rows: number): Promise<void> {
    await this.request(`N ${cols} ${rows}`)
  }

  async write(text: string): Promise<void> {
    await this.request(`W ${Buffer.from(text).toString('hex')}`)
  }

  async resize(cols: number, rows: number): Promise<void> {
    await this.request(`R ${cols} ${rows}`)
  }

  async track(slot: number): Promise<void> {
    await this.request(`T ${slot}`)
  }

  async point(slot: number): Promise<Point | null> {
    const result = (await this.request(`P ${slot}`)) as { point: Point | null }
    return result.point
  }

  async snapshot(): Promise<Snapshot> {
    return (await this.request('S')) as Snapshot
  }

  async close(): Promise<void> {
    this.process.stdin.end()
    const code = await this.process.exited
    const stderr = await this.stderr
    this.receipt({ kind: 'native-exit', terminal: this.label, code, stderr })
    if (stderr) console.error(stderr)
    assert.equal(code, 0, 'native process must exit cleanly')
  }
}
