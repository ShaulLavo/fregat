import type { RGBA8 } from './types'

export const RGBA_EMPTY: RGBA8 = { r: 0, g: 0, b: 0, a: 0 }
export const RGBA_WHITE: RGBA8 = { r: 255, g: 255, b: 255, a: 255 }
export const RGBA_BLACK: RGBA8 = { r: 0, g: 0, b: 0, a: 255 }

export function rgbaEquals(left: RGBA8, right: RGBA8): boolean {
  return left.r === right.r && left.g === right.g && left.b === right.b && left.a === right.a
}

export function transparent(color: RGBA8, ratio: number): RGBA8 {
  return { ...color, a: clamp8(color.a * ratio) }
}

export function rgbaToCss(color: RGBA8): string {
  return `rgba(${color.r}, ${color.g}, ${color.b}, ${color.a / 255})`
}

export function parseCssColor(value: string | undefined, fallback: RGBA8 = RGBA_EMPTY): RGBA8 {
  if (!value) return fallback

  const trimmed = value.trim()
  if (trimmed.startsWith('#')) return parseHexColor(trimmed, fallback)
  if (trimmed.startsWith('rgb')) return parseRgbColor(trimmed, fallback)
  return fallback
}

export function relativeLuminance(color: RGBA8): number {
  const r = linearRgb(color.r / 255)
  const g = linearRgb(color.g / 255)
  const b = linearRgb(color.b / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function clamp8(value: number): number {
  return Math.min(255, Math.max(0, Math.round(value)))
}

function parseHexColor(value: string, fallback: RGBA8): RGBA8 {
  const hex = value.slice(1)
  if (hex.length === 3) return shortHex(hex, fallback)
  if (hex.length === 4) return shortHexAlpha(hex, fallback)
  if (hex.length === 6) return longHex(hex, 'ff', fallback)
  if (hex.length === 8) return longHex(hex.slice(0, 6), hex.slice(6), fallback)
  return fallback
}

function shortHex(hex: string, fallback: RGBA8): RGBA8 {
  return longHex(
    hex
      .split('')
      .map((char) => char + char)
      .join(''),
    'ff',
    fallback,
  )
}

function shortHexAlpha(hex: string, fallback: RGBA8): RGBA8 {
  const rgb = hex.slice(0, 3)
  const alpha = hex[3] ?? 'f'
  return longHex(
    rgb
      .split('')
      .map((char) => char + char)
      .join(''),
    alpha + alpha,
    fallback,
  )
}

function longHex(rgb: string, alpha: string, fallback: RGBA8): RGBA8 {
  const value = Number.parseInt(rgb + alpha, 16)
  if (!Number.isFinite(value)) return fallback

  return {
    r: (value >> 24) & 0xff,
    g: (value >> 16) & 0xff,
    b: (value >> 8) & 0xff,
    a: value & 0xff,
  }
}

function parseRgbColor(value: string, fallback: RGBA8): RGBA8 {
  const body = value.slice(value.indexOf('(') + 1, value.lastIndexOf(')'))
  const parts = body.split(/[,\s/]+/).filter(Boolean)
  if (parts.length < 3) return fallback

  return {
    r: clamp8(Number(parts[0])),
    g: clamp8(Number(parts[1])),
    b: clamp8(Number(parts[2])),
    a: alphaPart(parts[3]),
  }
}

function alphaPart(value: string | undefined): number {
  if (!value) return 255
  if (value.endsWith('%')) return clamp8((Number.parseFloat(value) / 100) * 255)

  const number = Number(value)
  if (!Number.isFinite(number)) return 255
  if (number <= 1) return clamp8(number * 255)
  return clamp8(number)
}

function linearRgb(value: number): number {
  if (value <= 0.04045) return value / 12.92
  return ((value + 0.055) / 1.055) ** 2.4
}
