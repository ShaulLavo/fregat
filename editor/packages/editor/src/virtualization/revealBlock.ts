// 'center-if-outside' leaves a target already on screen where the reader is looking
// at it, and centres one that is not: a jump lands with context on both sides.
export type RevealBlock = 'nearest' | 'center' | 'end' | 'center-if-outside'
