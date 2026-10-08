import '@workspace/ui/globals.css'
import { afterEach, expect, test } from 'vitest'
import { FilterField } from '../filter-field'
import { mount } from '../../../test/render'

let cleanup = () => {}
afterEach(() => {
  cleanup()
  delete document.documentElement.dataset.density
})

test.each(['cozy', 'compact'])(
  'uses the UI font inside a monospace list in %s density',
  (density) => {
    document.documentElement.dataset.density = density
    const mounted = mount(
      <div className='font-mono'>
        <FilterField
          aria-label='Filter items'
          placeholder='Filter items'
          clearLabel='Clear filter'
          value=''
          onValueChange={() => {}}
          onArrowDown={() => {}}
          blurBehavior='retain'
        />
        <span className='font-sans'>UI font reference</span>
      </div>,
    )
    cleanup = mounted.unmount
    const input = mounted.container.querySelector('input')!
    const reference = mounted.container.querySelector('span')!
    const expected = getComputedStyle(reference).fontFamily
    expect(getComputedStyle(input).fontFamily).toBe(expected)
    expect(getComputedStyle(input, '::placeholder').fontFamily).toBe(expected)
  },
)
