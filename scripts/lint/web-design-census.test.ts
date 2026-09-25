import { readFileSync } from 'node:fs'

import { expect, test } from 'vitest'

// @ts-expect-error The census is a plain ES module and the scripts workspace has no `allowJs`.
import { censusSource, evaluate, isTestFile, TARGETS } from './web-design-census.mjs'

type Hit = { readonly file: string; readonly line: number; readonly value: string }
type Census = { readonly hits: Readonly<Record<string, readonly Hit[]>> }
type Result = {
  readonly offenders: Readonly<Record<string, readonly Hit[]>>
  readonly allowProblems: readonly string[]
  readonly passed: boolean
}

function census(...lines: readonly string[]): Census {
  return censusFile('probe.tsx', ...lines)
}

/** The path decides which root a measure is scoped to, and whether the file renders markup. */
function censusFile(file: string, ...lines: readonly string[]): Census {
  return censusSource(file, `${lines.join('\n')}\n`)
}

function values(subject: Census, measure: string): readonly string[] {
  return subject.hits[measure].map((hit) => hit.value)
}

function locations(subject: Census, measure: string): readonly string[] {
  return subject.hits[measure].map((hit) => `${hit.file}:${hit.line} ${hit.value}`)
}

function gate(subject: Census, allow: readonly unknown[] = []): Result {
  return evaluate(subject, allow)
}

test('finds a bare rounded built across the lines of a cn() call', () => {
  const subject = census(
    "import { cn } from '@workspace/ui/lib/utils'",
    '',
    'export function Row({ active }: { readonly active: boolean }) {',
    '  return (',
    '    <div',
    '      className={cn(',
    "        'flex items-center',",
    "        'rounded border-border',",
    "        active && 'bg-accent',",
    '      )}',
    '    />',
    '  )',
    '}',
  )

  expect(locations(subject, 'radius')).toEqual(['probe.tsx:8 rounded'])
  expect(values(subject, 'hairlines')).toEqual(['border-border'])
  expect(gate(subject).offenders.bareRadius).toHaveLength(1)
})

test('keeps a sized radius out of the bare bucket', () => {
  const subject = census("export const card = 'rounded-md border-border p-2'")

  expect(values(subject, 'radius')).toEqual(['rounded-md'])
  expect(gate(subject).offenders.bareRadius).toEqual([])
  expect(gate(subject).offenders.radius).toEqual([])
})

test('rejects the radius steps outside the settled scale and accepts the four on it', () => {
  const allowed: readonly string[] = TARGETS.radius.allowed
  const offScale = census("export const a = 'rounded-sm'", "export const b = 'rounded-[2px]'")
  const onScale = census(`export const a = '${allowed.map((step) => `rounded-${step}`).join(' ')}'`)

  expect(allowed).toEqual(['md', 'lg', 'full', 'none'])
  expect(gate(offScale).offenders.radius.map((hit) => hit.value)).toEqual([
    'rounded-sm',
    'rounded-[2px]',
  ])
  expect(gate(onScale).offenders.radius).toEqual([])
})

test('extracts a class string from a backtick template literal', () => {
  const subject = census(
    'export const chip = `inline-flex items-center',
    '  rounded-md text-[11px]`',
  )

  expect(locations(subject, 'radius')).toEqual(['probe.tsx:2 rounded-md'])
  expect(locations(subject, 'arbitraryText')).toEqual(['probe.tsx:2 text-[11px]'])
})

test('counts compact: utilities and leaves the plain utility alone', () => {
  const subject = census("export const row = 'compact:px-2 px-3'")

  expect(values(subject, 'compactVariant')).toEqual(['compact:px-2'])
})

test('counts every hairline but not a transparent sizing border', () => {
  const subject = census(
    "export const a = 'border-b border-border/60'",
    "export const b = 'border-subtle divide-x'",
    "export const c = 'border border-transparent aria-invalid:border-destructive'",
  )

  expect(values(subject, 'hairlines')).toEqual([
    'border-b',
    'border-border/60',
    'border-subtle',
    'divide-x',
  ])
})

test('counts an arbitrary text size but not a registered step', () => {
  const subject = census("export const a = 'text-[11px]'", "export const b = 'text-xs text-2xs'")

  expect(values(subject, 'arbitraryText')).toEqual(['text-[11px]'])
})

test('counts a raw button and attributes a radius override to the Button primitive', () => {
  const subject = census(
    'export function Row() {',
    '  return (',
    '    <div>',
    "      <button type='button' className='rounded-md px-2'>a</button>",
    "      <Button className='rounded-md'>b</Button>",
    '    </div>',
    '  )',
    '}',
  )

  expect(locations(subject, 'rawControls')).toEqual(['probe.tsx:4 <button>'])
  expect(locations(subject, 'buttonRadius')).toEqual(['probe.tsx:5 rounded-md'])
})

test('ignores a button that only appears inside a JSX comment', () => {
  const subject = census(
    'export function Row() {',
    '  return (',
    '    <span>',
    '      {/* a nested <button> would be invalid HTML */}',
    '    </span>',
    '  )',
    '}',
  )

  expect(subject.hits.rawControls).toEqual([])
})

test('catches a raw palette class and a hex literal but not a token', () => {
  const palette = census("export const a = 'bg-blue-600 text-foreground'")
  const hex = census("export const dot = { color: '#ff0000' }")
  const token = census("export const b = 'bg-primary text-muted-foreground'")

  expect(values(palette, 'paletteLeaks')).toEqual(['bg-blue-600'])
  expect(values(hex, 'paletteLeaks')).toEqual(['#ff0000'])
  expect(values(token, 'paletteLeaks')).toEqual([])
})

test('collects the height of a bar and every explicit bar-height token', () => {
  const bar = census("export const a = 'flex h-9 items-center border-b px-2'")
  const plain = census("export const b = 'flex h-9 gap-2'")
  const token = census("export const c = 'flex h-(--bar-height) gap-2'")

  expect(values(bar, 'barHeights')).toEqual(['h-9'])
  expect(values(plain, 'barHeights')).toEqual([])
  expect(values(token, 'barHeights')).toEqual(['h-(--bar-height)'])
  expect(gate(token).offenders.barHeights).toEqual([])
  expect(gate(bar).offenders.barHeights).toHaveLength(1)
})

test('allows only the three elevation steps', () => {
  const allowed: readonly string[] = TARGETS.shadow.allowed
  const off = census("export const a = 'shadow-lg'", "export const b = 'shadow-sm'")
  const on = census(`export const c = '${allowed.join(' ')}'`)

  expect(allowed).toEqual(['shadow-md', 'shadow-xl', 'shadow-none'])
  expect(gate(off).offenders.shadow.map((hit) => hit.value)).toEqual(['shadow-lg', 'shadow-sm'])
  expect(gate(on).offenders.shadow).toEqual([])
})

test('counts density variables and hover fills', () => {
  const subject = census(
    "export const a = 'h-(--bar-height) px-(--density-control-padding-x) w-(--rail-width)'",
    "export const b = 'hover:bg-row-hover hover:text-foreground'",
  )

  expect(values(subject, 'densityVars')).toEqual([
    '(--bar-height)',
    '(--density-control-padding-x)',
    '(--rail-width)',
  ])
  expect(values(subject, 'hoverFills')).toEqual(['hover:bg-row-hover'])
})

test('reports an allow-list exception with no reason as a violation of its own', () => {
  const subject = census("export const a = 'rounded'")
  const result = gate(subject, [{ file: 'probe.tsx', class: 'rounded' }])

  expect(result.allowProblems).toHaveLength(1)
  expect(result.allowProblems[0]).toContain('an exception without a reason is itself a violation')
  expect(result.offenders.bareRadius).toHaveLength(1)
  expect(result.passed).toBe(false)
})

test('suppresses a hit once its allow-list entry carries a reason', () => {
  const subject = census("export const a = 'rounded'")
  const result = gate(subject, [
    { file: 'probe.tsx', class: 'rounded', reason: 'third-party embed owns this corner' },
  ])

  expect(result.allowProblems).toEqual([])
  expect(result.offenders.bareRadius).toEqual([])
  expect(result.passed).toBe(true)
})

test('reports the line of every hit in a multi-line file', () => {
  const subject = census(
    "import { cn } from '@workspace/ui/lib/utils'",
    '',
    'export function Panel() {',
    "  const header = cn('flex items-center border-b h-9')",
    '  return (',
    '    <section className={header}>',
    "      <span className='text-[10px] border-border/70'>one</span>",
    '      <span className={`rounded',
    '        shadow-lg`}>two</span>',
    '    </section>',
    '  )',
    '}',
  )

  expect(locations(subject, 'barHeights')).toEqual(['probe.tsx:4 h-9'])
  expect(locations(subject, 'arbitraryText')).toEqual(['probe.tsx:7 text-[10px]'])
  expect(locations(subject, 'hairlines')).toEqual([
    'probe.tsx:4 border-b',
    'probe.tsx:7 border-border/70',
  ])
  expect(locations(subject, 'radius')).toEqual(['probe.tsx:8 rounded'])
  expect(locations(subject, 'shadow')).toEqual(['probe.tsx:9 shadow-lg'])
})

test('excludes every flavour of test file from the walk', () => {
  expect(isTestFile('features/git/components/header.tsx')).toBe(false)
  expect(isTestFile('features/git/tests/header.tsx')).toBe(true)
  expect(isTestFile('features/git/components/header.test.tsx')).toBe(true)
  expect(isTestFile('features/git/components/header.browser.tsx')).toBe(true)
  expect(isTestFile('features/git/components/header.test-d.tsx')).toBe(true)
})

test('excludes test files written as .ts, not only .tsx', () => {
  expect(isTestFile('features/git/utils/parse.ts')).toBe(false)
  expect(isTestFile('features/git/utils/parse.test.ts')).toBe(true)
  expect(isTestFile('features/git/utils/parse.test-d.ts')).toBe(true)
  expect(isTestFile('features/git/tests/factory.ts')).toBe(true)
})

test('censuses a .ts module that exports class-name strings', () => {
  const subject = censusFile(
    'apps/web/src/features/file-picker/navigation/navigation-styles.ts',
    "export const PILL_BASE = 'shrink-0 rounded-sm bg-blue-600'",
    "export const PILL_SELECTED = 'hover:bg-row-hover'",
  )

  expect(values(subject, 'radius')).toEqual(['rounded-sm'])
  expect(values(subject, 'paletteLeaks')).toEqual(['bg-blue-600'])
  expect(values(subject, 'hoverFills')).toEqual(['hover:bg-row-hover'])
  expect(gate(subject).offenders.radius).toHaveLength(1)
})

test('counts a hex literal in markup and leaves one in a .ts module as data', () => {
  const markup = censusFile('apps/web/src/components/dot.tsx', "export const dot = '#ff0000'")
  const data = censusFile(
    'apps/web/src/lib/code-theme/utils/catalog.ts',
    "export const c = '#1e1e1e'",
  )
  const className = censusFile('apps/web/src/lib/nav.ts', "export const c = 'bg-blue-600'")

  expect(values(markup, 'paletteLeaks')).toEqual(['#ff0000'])
  expect(values(data, 'paletteLeaks')).toEqual([])
  expect(values(className, 'paletteLeaks')).toEqual(['bg-blue-600'])
})

test('walks the primitives package but drops the two measures a primitive cannot break', () => {
  const source = [
    'export function Control() {',
    '  return (',
    '    <div>',
    "      <button type='button' className='rounded text-[11px]'>a</button>",
    "      <Button className='rounded-md'>b</Button>",
    '    </div>',
    '  )',
    '}',
  ] as const
  const app = gate(censusFile('apps/web/src/components/control.tsx', ...source))
  const ui = gate(censusFile('packages/ui/src/components/button.tsx', ...source))

  expect(app.offenders.rawControls).toHaveLength(1)
  expect(app.offenders.buttonRadius).toHaveLength(1)
  expect(ui.offenders.rawControls).toEqual([])
  expect(ui.offenders.buttonRadius).toEqual([])
  // The measures that do judge a primitive keep judging it.
  expect(ui.offenders.bareRadius).toHaveLength(1)
  expect(ui.offenders.arbitraryText).toHaveLength(1)
})

test('flags a redundant rounded-none until an allow-list entry explains it', () => {
  const subject = census("export const panel = 'flex flex-col rounded-none'")
  const excused = gate(subject, [
    { file: 'probe.tsx', class: 'rounded-none', reason: 'the arrow is a rotated square' },
  ])

  expect(gate(subject).offenders.nullRadius).toHaveLength(1)
  expect(gate(subject).offenders.radius).toEqual([])
  expect(excused.offenders.nullRadius).toEqual([])
  expect(excused.passed).toBe(true)
})

test('reads a grid bar with a border edge as a bar', () => {
  const grid = census("export const titlebar = 'grid h-9 shrink-0 border-b'")
  const block = census("export const panel = 'grid h-9 gap-2'")
  const responsive = census(
    "export const header = 'flex flex-col border-b @max-3xl:grid @max-3xl:[&_input]:h-10'",
  )

  expect(values(grid, 'barHeights')).toEqual(['h-9'])
  expect(gate(grid).offenders.barHeights).toHaveLength(1)
  expect(values(block, 'barHeights')).toEqual([])
  expect(values(responsive, 'barHeights')).toEqual([])
})

test('flags an arbitrary text size in any unit and leaves arbitrary colours alone', () => {
  const sizes = census("export const a = 'text-[0.9em] text-[11px] text-[1.5rem] text-[2vw]'")
  const colour = census("export const b = 'text-[var(--sdm-c,inherit)]'")

  expect(values(sizes, 'arbitraryText')).toEqual([
    'text-[0.9em]',
    'text-[11px]',
    'text-[1.5rem]',
    'text-[2vw]',
  ])
  expect(gate(sizes).offenders.arbitraryText).toHaveLength(4)
  expect(values(colour, 'arbitraryText')).toEqual([])
})

test('gates an opacity modifier on a row fill and only reports every other hover', () => {
  const rows = census(
    "export const a = 'hover:bg-row-hover/50'",
    "export const b = 'bg-row-selected/40'",
  )
  const plain = census("export const c = 'hover:bg-accent hover:bg-row-hover'")

  expect(values(rows, 'hoverFills')).toEqual(['hover:bg-row-hover/50', 'bg-row-selected/40'])
  expect(gate(rows).offenders.hoverFills).toHaveLength(2)
  expect(values(plain, 'hoverFills')).toEqual(['hover:bg-accent', 'hover:bg-row-hover'])
  expect(gate(plain).offenders.hoverFills).toEqual([])
  expect(typeof TARGETS.hoverFills.gates).toBe('string')
})

test('is wired into the repository: a script entry and a place in the verify chain', () => {
  const manifest = JSON.parse(
    readFileSync(new URL('../../package.json', import.meta.url), 'utf8'),
  ) as { readonly scripts: Readonly<Record<string, string>> }

  expect(manifest.scripts['design:census']).toContain('web-design-census.mjs --check')
  expect(manifest.scripts.verify).toContain('bun run design:census')
})

test('counts a truncating element unless it or an enclosing element carries a title', () => {
  const own = census(
    'export function Row({ path }: { readonly path: string }) {',
    "  return <span title={path} className='truncate'>{path}</span>",
    '}',
  )
  const ancestor = census(
    'export function Row({ path }: { readonly path: string }) {',
    '  return (',
    "    <button type='button' title={path}>",
    "      <span className='truncate'>{path}</span>",
    '    </button>',
    '  )',
    '}',
  )
  const neither = census(
    'export function Row({ path }: { readonly path: string }) {',
    '  return (',
    "    <div className='flex'>",
    "      <span className='truncate'>{path}</span>",
    "      <p className='line-clamp-3'>{path}</p>",
    '    </div>',
    '  )',
    '}',
  )

  expect(values(own, 'truncationRecovery')).toEqual([])
  expect(values(ancestor, 'truncationRecovery')).toEqual([])
  expect(locations(neither, 'truncationRecovery')).toEqual([
    'probe.tsx:4 truncate',
    'probe.tsx:5 line-clamp-3',
  ])
})

test('excuses a truncating element through the allow-list and skips the primitives package', () => {
  const source = "export const Label = () => <span className='truncate'>Chat</span>"
  const app = censusFile('apps/web/src/components/label.tsx', source)
  const ui = censusFile('packages/ui/src/components/label.tsx', source)
  const excused = gate(app, [
    {
      file: 'apps/web/src/components/label.tsx',
      class: 'truncate',
      reason: 'D3: an app-authored label that no real layout cuts',
    },
  ])

  expect(values(app, 'truncationRecovery')).toEqual(['truncate'])
  expect(values(ui, 'truncationRecovery')).toEqual(['truncate'])
  expect(gate(app).offenders.truncationRecovery).toHaveLength(1)
  expect(excused.offenders.truncationRecovery).toEqual([])
  expect(gate(ui).offenders.truncationRecovery).toEqual([])
})

test('icon size accepts the two density tokens and rejects literal sizes on icons', () => {
  const subject = census(
    "export const Icons = () => <><AddIcon className='size-4' /><ChevronIcon className={cn('size-(--icon-size)', active && 'size-3')} /><Icons.CheckIcon className='size-(--icon-size-sm)' /><div className='size-8' /></>",
  )
  expect(values(subject, 'iconSize')).toEqual([
    'size-4',
    'size-(--icon-size)',
    'size-3',
    'size-(--icon-size-sm)',
  ])
  expect(gate(subject).offenders.iconSize.map((hit) => hit.value)).toEqual(['size-4', 'size-3'])
})

test('icon size inspects className instead of unrelated strings passed to an icon', () => {
  const subject = census("export const Icon = () => <AddIcon aria-label='size-4' title='size-3' />")
  expect(values(subject, 'iconSize')).toEqual([])
})

test('text alpha rejects color modifiers and fades on elements containing text', () => {
  const subject = census(
    "export const Text = () => <><span className='text-foreground/75'>Value</span><div className='opacity-60'><span>{label}</span></div><span className='opacity-0'>Hidden</span><span className='opacity-100'>Shown</span><i className='opacity-35'><AddIcon /></i></>",
    "export const muted = 'text-muted-foreground/50'",
  )
  expect(values(subject, 'textAlpha')).toEqual([
    'text-foreground/75',
    'opacity-60',
    'text-muted-foreground/50',
  ])
  expect(gate(subject).offenders.textAlpha).toHaveLength(3)
})

test('disabled text controls may fade to 50 percent without introducing a third text color', () => {
  const subject = census(
    "export const Controls = () => <><Button disabled={pending} className='opacity-50'>Save</Button><Button aria-disabled={pending} className='opacity-50'>Open</Button><Button className='disabled:opacity-50'>Close</Button><Button disabled className='opacity-60 text-muted-foreground/50'>Bad</Button></>",
  )
  expect(values(subject, 'textAlpha')).toEqual(['opacity-60', 'text-muted-foreground/50'])
})

test('row hover gates ListRow and row roles while preserving the general hover histogram', () => {
  const subject = census(
    "export const Rows = () => <><ListRow className='hover:bg-accent' /><div role='option' className='hover:bg-muted' /><div role='treeitem' className='hover:bg-row-hover' /><Button className='hover:bg-accent'>Action</Button></>",
  )
  expect(values(subject, 'hoverFills')).toEqual([
    'hover:bg-accent',
    'hover:bg-muted',
    'hover:bg-row-hover',
    'hover:bg-accent',
  ])
  expect(gate(subject).offenders.hoverFills.map((hit) => hit.value)).toEqual([
    'hover:bg-accent',
    'hover:bg-muted',
  ])
  const rowFile = censusFile(
    'apps/web/src/features/probe/components/item-row.tsx',
    "export const classes = 'hover:bg-accent'",
  )
  expect(gate(rowFile).offenders.hoverFills).toHaveLength(1)
})

test('icon-only controls require a Tooltip and reject a native title beside it', () => {
  const subject = census(
    "export const Controls = () => <><Button title='Add'><AddIcon /></Button><button aria-label='Close'><CloseIcon /></button><Tooltip><TooltipTrigger><Button><PlusIcon /></Button></TooltipTrigger></Tooltip><Tooltip><Button aria-label='Open'><OpenIcon /></Button></Tooltip><Tooltip><TooltipTrigger><Button title='Duplicate'><CopyIcon /></Button></TooltipTrigger></Tooltip><Button><Icon />Label</Button></>",
  )
  expect(values(subject, 'iconOnlyHint')).toEqual([
    'icon-only title',
    'missing Tooltip',
    'missing Tooltip',
    'icon-only title',
  ])
  expect(gate(subject).offenders.iconOnlyHint).toHaveLength(4)
})

test('icon-only controls accept the shared tooltip layer but still need focusableWhenDisabled', () => {
  const subject = census(
    "export const Controls = () => <><Button data-tooltip='Stage' disabled focusableWhenDisabled><PlusIcon /></Button><Button data-tooltip='Discard' disabled><UndoIcon /></Button></>",
  )
  expect(values(subject, 'iconOnlyHint')).toEqual([
    'disabled Tooltip trigger needs focusableWhenDisabled',
  ])
})

test('icon-only controls recognize conditional icons and TooltipTrigger render props', () => {
  const subject = census(
    'export const Controls = () => <><Button>{open ? <MinusIcon /> : <PlusIcon />}</Button><Tooltip><TooltipTrigger render={<Button><PlusIcon /></Button>} /></Tooltip><IconTooltip label="Add"><Button aria-label="Add"><AddIcon /></Button></IconTooltip></>',
  )
  expect(values(subject, 'iconOnlyHint')).toEqual(['missing Tooltip'])
})

test('icon-only controls include nested icon compositions but exclude visible labels', () => {
  const subject = census(
    `export const Controls = () => <><Button title='New chat'><span><ChatIcon /><PlusIcon /></span></Button><Button><span><ChatIcon />Chat</span></Button><Button><CustomContent /></Button></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual(['icon-only title'])
})

test('icon-only controls inherit children from primitive trigger render composition', () => {
  const subject = census(
    `export const Controls = () => <><DropdownMenuTrigger render={<Button title='History' />}><ClockIcon /></DropdownMenuTrigger><Tooltip><TooltipTrigger render={<DropdownMenuTrigger render={<Button aria-label='History' />} />}><ClockIcon /></TooltipTrigger><TooltipContent>History</TooltipContent></Tooltip><DropdownMenuTrigger render={<Button />}><ClockIcon />History</DropdownMenuTrigger></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual(['icon-only title'])
})

test('icon sizes require tooltips for wrappers with dynamic or self-closing children', () => {
  const subject = census(
    `export const Controls = () => <><Button size='icon-xs' title={label}>{children}</Button><Button size='icon-sm' aria-label='Close' /><Button size='sm'>{children}</Button></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual(['icon-only title', 'missing Tooltip'])
})

test('input group buttons and bare primitive triggers require tooltips', () => {
  const subject = census(
    `export const Controls = () => <><InputGroupButton aria-label='Clear'><XIcon /></InputGroupButton><PopoverTrigger aria-label='Options'><DotsIcon /></PopoverTrigger><DropdownMenuTrigger render={<Button><DotsIcon /></Button>} /><Tooltip><TooltipTrigger render={<InputGroupButton size='icon-xs' />}><XIcon /></TooltipTrigger></Tooltip><PopoverTrigger>Options</PopoverTrigger></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual([
    'missing Tooltip',
    'missing Tooltip',
    'missing Tooltip',
  ])
})

test('screen-reader labels do not exempt icon controls from a visible tooltip', () => {
  const subject = census(
    `export const Controls = () => <><Button><XIcon /><span className='sr-only'>Close</span></Button><DialogClose render={<Button size='icon-sm' />}><XIcon /><span className='sr-only'>Close</span></DialogClose><Button><XIcon /><span>Close</span></Button></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual(['missing Tooltip', 'missing Tooltip'])
})

test('icons include SVGs, image controls, loading states and conditional compact labels', () => {
  const subject = census(
    `export const Controls = () => <><Button><svg /></Button><Button><img alt='' /></Button><Button>{pending ? <Spinner /> : <CheckIcon />}</Button><Button><svg />{compact ? null : <span>{label}</span>}</Button><Button><Spinner />Saving</Button><Button><svg />{label}</Button></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual([
    'missing Tooltip',
    'missing Tooltip',
    'missing Tooltip',
    'missing Tooltip',
  ])
})

test('icon links and role buttons require tooltips', () => {
  const subject = census(
    `export const Controls = () => <><a href='/help'><HelpIcon /></a><div role='button'><PlayIcon /></div><div><PlayIcon /></div><a href='/help'><HelpIcon />Help</a></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual(['missing Tooltip', 'missing Tooltip'])
})

test('a Tooltip root and controls inside TooltipContent are not tooltip triggers', () => {
  const subject = census(
    `export const Controls = () => <><Tooltip><Button aria-label='Add'><AddIcon /></Button></Tooltip><Tooltip><TooltipTrigger render={<Button size='icon-sm' />} /><TooltipContent><Button><CopyIcon /></Button></TooltipContent></Tooltip></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual(['missing Tooltip', 'missing Tooltip'])
})

test('disabled icon tooltip controls remain hoverable and keyboard focusable', () => {
  const subject = census(
    `export const Controls = () => <><Tooltip><TooltipTrigger render={<Button disabled size='icon-sm' />} /></Tooltip><Tooltip><TooltipTrigger render={<InputGroupButton disabled={pending}><XIcon /></InputGroupButton>} /></Tooltip><Tooltip><TooltipTrigger render={<Button disabled focusableWhenDisabled={false}><XIcon /></Button>} /></Tooltip><Tooltip><TooltipTrigger render={<Button disabled focusableWhenDisabled size='icon-sm' />} /></Tooltip><Tooltip><TooltipTrigger render={<Button disabled={false}><XIcon /></Button>} /></Tooltip><Tooltip><TooltipTrigger disabled render={<Button size='icon-sm' />} /></Tooltip><Tooltip><TooltipTrigger render={<Button disabled>Save</Button>} /></Tooltip></>`,
  )
  expect(values(subject, 'iconOnlyHint')).toEqual([
    'disabled Tooltip trigger needs focusableWhenDisabled',
    'disabled Tooltip trigger needs focusableWhenDisabled',
    'disabled Tooltip trigger needs focusableWhenDisabled',
  ])
})

test('records every element a primitive exists for, not only <button>', () => {
  const subject = census(
    'export function Probe() {',
    '  return (',
    '    <form>',
    '      <input />',
    '      <textarea />',
    '      <select />',
    '    </form>',
    '  )',
    '}',
  )

  expect(locations(subject, 'rawControls')).toEqual([
    'probe.tsx:4 <input>',
    'probe.tsx:5 <textarea>',
    'probe.tsx:6 <select>',
  ])
})

test('fails an allow-list entry that matches nothing in the census', () => {
  const subject = census('export const value = 1')
  const result: Result = evaluate(subject, [
    { file: 'gone.tsx', class: '<button>', reason: 'Once true.' },
  ])

  expect(result.passed).toBe(false)
  expect(result.allowProblems[0]).toContain('stale')
})
