import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { parseArgs } from 'node:util'
import { chromium } from '@playwright/test'
import { fail } from './errors.mjs'

// E036 candidate 6: which events Chromium's EditContext delivers for each input the textarea route
// has to handle, recorded on a bare page so no editor code shapes the answer.
const { values } = parseArgs({ options: { output: { type: 'string' } } })
if (!values.output) fail('--output is required')

const PAGE = `<!doctype html><body><div id="host" tabindex="0" style="width:400px;height:40px"></div>
<script>
  const host = document.getElementById('host')
  const log = []
  window.__log = log
  window.__prevent = new Set()
  const context = new EditContext({ text: 'hello world', selectionStart: 5, selectionEnd: 5 })
  host.editContext = context
  const snap = () => ({ text: context.text, selectionStart: context.selectionStart, selectionEnd: context.selectionEnd })
  for (const type of ['keydown', 'beforeinput', 'input', 'paste', 'copy', 'cut', 'compositionstart', 'compositionupdate', 'compositionend'])
    host.addEventListener(type, (event) => {
      if (type === 'keydown' && window.__prevent.has(event.key)) event.preventDefault()
      if (type === 'beforeinput' && window.__prevent.has('beforeinput:' + event.data)) event.preventDefault()
      log.push({ target: 'element', type, key: event.key, inputType: event.inputType, data: event.data ?? null, defaultPrevented: event.defaultPrevented })
    })
  context.addEventListener('textupdate', (event) => log.push({ target: 'context', type: 'textupdate', text: event.text, updateRangeStart: event.updateRangeStart, updateRangeEnd: event.updateRangeEnd, selectionStart: event.selectionStart, selectionEnd: event.selectionEnd, after: snap() }))
  context.addEventListener('textformatupdate', (event) => log.push({ target: 'context', type: 'textformatupdate', formats: event.getTextFormats().map((f) => ({ rangeStart: f.rangeStart, rangeEnd: f.rangeEnd, underlineStyle: f.underlineStyle, underlineThickness: f.underlineThickness })) }))
  context.addEventListener('characterboundsupdate', (event) => log.push({ target: 'context', type: 'characterboundsupdate', rangeStart: event.rangeStart, rangeEnd: event.rangeEnd }))
  for (const type of ['compositionstart', 'compositionend'])
    context.addEventListener(type, (event) => log.push({ target: 'context', type, data: event.data ?? null }))
  window.__reset = (text, start, end) => { context.updateText(0, context.text.length, text); context.updateSelection(start, end); log.length = 0; window.__prevent.clear() }
  window.__snap = snap
</script></body>`

const cases = [
  ['type "ab"', async (page) => page.keyboard.type('ab')],
  ['Backspace', async (page) => page.keyboard.press('Backspace')],
  ['Delete', async (page) => page.keyboard.press('Delete')],
  ['Ctrl+Backspace', async (page) => page.keyboard.press('Control+Backspace')],
  ['Enter', async (page) => page.keyboard.press('Enter')],
  ['Shift+Enter', async (page) => page.keyboard.press('Shift+Enter')],
  ['Tab', async (page) => page.keyboard.press('Tab')],
  [
    'Backspace with keydown prevented',
    async (page) => {
      await page.evaluate(() => window.__prevent.add('Backspace'))
      await page.keyboard.press('Backspace')
    },
  ],
  [
    'type "x" with keydown prevented',
    async (page) => {
      await page.evaluate(() => window.__prevent.add('x'))
      await page.keyboard.type('x')
    },
  ],
  [
    'type "y" with beforeinput prevented',
    async (page) => {
      await page.evaluate(() => window.__prevent.add('beforeinput:y'))
      await page.keyboard.type('y')
    },
  ],
  [
    'IME compose に → にほ, commit 日本',
    async (page, cdp) => {
      await cdp.send('Input.imeSetComposition', { text: 'に', selectionStart: 1, selectionEnd: 1 })
      await cdp.send('Input.imeSetComposition', {
        text: 'にほ',
        selectionStart: 2,
        selectionEnd: 2,
      })
      await cdp.send('Input.insertText', { text: '日本' })
    },
  ],
  [
    'IME compose then cancel (empty composition)',
    async (page, cdp) => {
      await cdp.send('Input.imeSetComposition', { text: 'か', selectionStart: 1, selectionEnd: 1 })
      await cdp.send('Input.imeSetComposition', { text: '', selectionStart: 0, selectionEnd: 0 })
    },
  ],
  [
    'replacement composition over "hello" (autocorrect shape)',
    async (page, cdp) => {
      await cdp.send('Input.imeSetComposition', {
        text: 'Hello',
        selectionStart: 5,
        selectionEnd: 5,
        replacementStart: 0,
        replacementEnd: 5,
      })
      await cdp.send('Input.insertText', { text: 'Hello' })
    },
  ],
  [
    'insertText without composition (dictation shape)',
    async (page, cdp) => cdp.send('Input.insertText', { text: 'spoken words' }),
  ],
  [
    'paste',
    async (page) => {
      await page.evaluate(() => navigator.clipboard.writeText('pasted\ntext'))
      await page.keyboard.press('Control+V')
    },
  ],
]

const browser = await chromium.launch({ headless: true })
const result = { browser: browser.version(), cases: [] }
try {
  const context = await browser.newContext()
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  const page = await context.newPage()
  await page.route('https://probe.local/', (route) =>
    route.fulfill({ body: PAGE, contentType: 'text/html' }),
  )
  await page.goto('https://probe.local/')
  result.supported = await page.evaluate(() => 'EditContext' in window)
  if (!result.supported) fail('EditContext is not available in this browser')
  const cdp = await context.newCDPSession(page)
  await page.click('#host')
  for (const [name, run] of cases) {
    await page.evaluate(() => window.__reset('hello world', 5, 5))
    await page.click('#host')
    await page.evaluate(() => {
      window.__log.length = 0
    })
    await run(page, cdp)
    await page.waitForTimeout(50)
    const row = await page.evaluate(() => ({
      events: window.__log.slice(),
      final: window.__snap(),
    }))
    result.cases.push({ name, ...row })
    console.log(`\n## ${name} → ${JSON.stringify(row.final)}`)
    for (const event of row.events) console.log('  ' + JSON.stringify(event))
  }
} finally {
  await browser.close()
}
await mkdir(dirname(resolve(values.output)), { recursive: true })
await writeFile(values.output, JSON.stringify(result, null, 2) + '\n')
