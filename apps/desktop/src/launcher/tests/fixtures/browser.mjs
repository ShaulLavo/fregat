import { closeSync, writeSync } from 'node:fs'

const mode = process.argv[2]
await Bun.write(process.argv[3], String(process.pid))
if (mode === 'handoff') {
  closeSync(4)
  await Bun.sleep(300)
  process.exit(0)
}
if (mode === 'exit-failure') process.exit(7)
if (mode === 'silent') {
  await Bun.sleep(30_000)
  process.exit(0)
}
let buffered = ''
for await (const chunk of Bun.file(3).stream()) {
  buffered += new TextDecoder().decode(chunk)
  let end = buffered.indexOf('\0')
  while (end !== -1) {
    const message = JSON.parse(buffered.slice(0, end))
    buffered = buffered.slice(end + 1)
    const result = message.method === 'Browser.getVersion' ? { product: 'Chrome/125.0.1' } : {}
    writeSync(4, JSON.stringify({ id: message.id, result }) + '\0')
    end = buffered.indexOf('\0')
  }
}
