import { isIP } from 'node:net'

export function clientAddressKey(address: string, prefix: number): string | undefined {
  const family = isIP(address)
  if (family === 4) return address
  if (family !== 6) return undefined
  const value = address.split('%')[0]!
  const tail = value.slice(value.lastIndexOf(':') + 1)
  const bytes = tail.split('.').map(Number)
  const expanded = tail.includes('.')
    ? value.slice(0, value.lastIndexOf(':') + 1) +
      `${(bytes[0]! * 256 + bytes[1]!).toString(16)}:${(bytes[2]! * 256 + bytes[3]!).toString(16)}`
    : value
  const [left, right] = expanded.split('::')
  const head = left ? left.split(':').map((word) => parseInt(word, 16)) : []
  const end = right ? right.split(':').map((word) => parseInt(word, 16)) : []
  const words = head.concat(Array<number>(8 - head.length - end.length).fill(0), end)
  if (words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff)
    return [words[6]! >>> 8, words[6]! & 255, words[7]! >>> 8, words[7]! & 255].join('.')
  return (
    words
      .map((word, index) => {
        const bits = Math.min(16, Math.max(0, prefix - index * 16))
        return (word & (0xffff << (16 - bits))).toString(16)
      })
      .join(':') + `/${prefix}`
  )
}
