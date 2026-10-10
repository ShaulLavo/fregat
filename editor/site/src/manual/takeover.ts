import { startReader } from './reader'
void startReader(false)
const menu = document.querySelector<HTMLDetailsElement>('details.menu')
document.addEventListener('pointerdown', (event) => {
  if (menu?.open && !menu.contains(event.target as Node)) menu.open = false
})
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !menu?.open) return
  menu.open = false
  menu.querySelector('summary')?.focus()
})
