import { writeFileSync } from 'node:fs'
const [pidFile, behavior] = process.argv.slice(2)
writeFileSync(pidFile, String(process.pid))
if (behavior === 'cancel') {
  console.log('{"event":"picked","paths":[]}')
  process.exit(0)
}
if (behavior === 'success') {
  console.log('{"event":"picked","paths":["/fixture/資料"]}')
  process.exit(0)
}
if (behavior === 'message') {
  console.log('{"event":"closed"}')
  process.exit(0)
}
if (behavior === 'malformed') console.log('invalid protocol')
if (behavior === 'error') {
  console.error('private file content and secret')
  process.exit(7)
}
process.on('SIGTERM', () => {})
setInterval(() => {}, 1000)
