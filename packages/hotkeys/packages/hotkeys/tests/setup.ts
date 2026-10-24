// happy-dom reports AltGraph whenever Alt is held; browsers report it only for AltGr.
// Tests that need AltGraph define getModifierState on their event.
KeyboardEvent.prototype.getModifierState = function (this: KeyboardEvent, modifier: string) {
  if (modifier === 'Control') return this.ctrlKey
  if (modifier === 'Alt') return this.altKey
  if (modifier === 'Shift') return this.shiftKey
  if (modifier === 'Meta') return this.metaKey
  return false
}
