// Scripted replica player. An element marked data-at="n" appears at step n; data-until="n" hides
// it from step n on. data-timeline on .rep lists the times (ms) of steps 1..N. Reduced motion and
// a press on the replica jump to the final step; the story pauses off-screen and in hidden tabs.
// A [data-motion-for] button pauses, resumes and replays its plate; an ended plate stops moving.
const reduce = matchMedia('(prefers-reduced-motion: reduce)')

for (const stage of document.querySelectorAll<HTMLElement>('[data-replica]')) setup(stage)

// Section plates load their wallpaper shortly before they scroll into view.
const lighter = new IntersectionObserver(
  (entries) => {
    for (const entry of entries) {
      if (!entry.isIntersecting) continue
      entry.target.classList.add('lit')
      lighter.unobserve(entry.target)
    }
  },
  { rootMargin: '600px 0px' },
)
for (const plate of document.querySelectorAll('.plate:not(.lit)')) lighter.observe(plate)

function setup(stage: HTMLElement): void {
  const rep = stage.querySelector<HTMLElement>('.rep')
  if (!rep) return
  const times = (rep.dataset.timeline ?? '').split(',').filter(Boolean).map(Number)
  const last = times.length
  const narrowAt = Number(stage.dataset.narrowAt ?? 640)
  const pointer = rep.querySelector<HTMLElement>('.pointer')
  let step = 0
  let timer = 0
  let visible = false
  let held = false
  let elapsedAt = 0
  let clock = 0

  function fit(): void {
    const width = stage.clientWidth
    const narrow = width < narrowAt
    rep!.classList.toggle('narrow', narrow)
    const base = narrow ? 440 : Number(stage.dataset.base ?? 1280)
    // Below data-min-k the window keeps its size and the plate crops it.
    const k = Math.max(width / base, Number(stage.dataset.minK ?? 0))
    rep!.style.setProperty('--k', String(k))
  }

  function type(element: HTMLElement): void {
    const text = element.dataset.full ?? element.textContent ?? ''
    element.dataset.full = text
    const duration = Number(element.dataset.type) || 900
    let shown = 0
    element.textContent = ''
    element.classList.add('caret')
    const tick = (): void => {
      if (rep!.classList.contains('paused')) {
        setTimeout(tick, 30)
        return
      }
      shown += Math.max(1, Math.round(text.length / (duration / 30)))
      element.textContent = text.slice(0, shown)
      if (shown < text.length) {
        setTimeout(tick, 30)
        return
      }
      element.classList.remove('caret')
    }
    tick()
  }

  function point(target: HTMLElement, press: boolean): void {
    if (!pointer) return
    const k = Number(rep!.style.getPropertyValue('--k')) || 1
    const frame = rep!.getBoundingClientRect()
    const box = target.getBoundingClientRect()
    const x = (box.left - frame.left + box.width * 0.62) / k
    const y = (box.top - frame.top + box.height * 0.6) / k
    pointer.style.opacity = '1'
    pointer.style.transform = `translate(${x}px, ${y}px)`
    if (!press) return
    setTimeout(() => {
      pointer.classList.add('press')
      target.classList.add('pressed')
      setTimeout(() => {
        pointer.classList.remove('press')
        target.classList.remove('pressed')
      }, 160)
    }, 720)
  }

  function apply(next: number, animate: boolean): void {
    step = next
    rep!.classList.toggle('instant', !animate)
    for (const element of rep!.querySelectorAll<HTMLElement>('[data-at]')) {
      const at = Number(element.dataset.at)
      element.classList.toggle('in', at <= next)
      if (animate && at === next && element.hasAttribute('data-type')) type(element)
      if (!animate && element.dataset.full) element.textContent = element.dataset.full
    }
    for (const element of rep!.querySelectorAll<HTMLElement>('[data-until]')) {
      element.classList.toggle('out', next >= Number(element.dataset.until))
    }
    for (const element of rep!.querySelectorAll<HTMLElement>('[data-point]')) {
      if (animate && Number(element.dataset.point) === next) {
        point(element, element.hasAttribute('data-press'))
      }
    }
    if (pointer && next >= last) pointer.style.opacity = '0'
    rep!.classList.toggle('settled', next >= last)
    render()
  }

  function running(): boolean {
    return visible && !document.hidden && !held
  }

  function schedule(): void {
    clearTimeout(timer)
    timer = 0
    if (!running() || step >= last) return
    const due = (times[step] ?? 0) - clock
    elapsedAt = performance.now()
    timer = window.setTimeout(
      () => {
        timer = 0
        clock = times[step] ?? clock
        apply(step + 1, true)
        schedule()
      },
      Math.max(0, due),
    )
  }

  function halt(): void {
    if (timer) clock += performance.now() - elapsedAt
    clearTimeout(timer)
    timer = 0
    rep!.classList.add('paused')
    render()
  }

  function proceed(): void {
    if (!running()) return
    rep!.classList.remove('paused')
    render()
    schedule()
  }

  function end(): void {
    clearTimeout(timer)
    timer = 0
    held = false
    rep!.classList.remove('paused')
    apply(last, false)
  }

  function replay(): void {
    clearTimeout(timer)
    timer = 0
    held = false
    for (const element of rep!.querySelectorAll<HTMLElement>('[data-full]')) {
      element.textContent = element.dataset.full ?? ''
    }
    clock = 0
    rep!.classList.remove('paused')
    apply(0, false)
    if (reduce.matches) {
      end()
      return
    }
    schedule()
  }

  function toggle(): void {
    if (step >= last) return replay()
    held = !held
    if (held) halt()
    else proceed()
  }

  function render(): void {
    for (const button of buttons) {
      button.hidden = reduce.matches
      button.textContent = step >= last ? 'Replay' : held ? 'Play' : 'Pause'
    }
  }

  const buttons = document.querySelectorAll<HTMLButtonElement>(`[data-motion-for="${stage.id}"]`)
  for (const button of buttons) button.addEventListener('click', toggle)
  fit()
  new ResizeObserver(fit).observe(stage)
  apply(0, false)
  if (reduce.matches) end()

  rep.addEventListener('pointerdown', end)
  new IntersectionObserver(
    ([entry]) => {
      visible = entry?.isIntersecting ?? false
      if (reduce.matches) return
      if (visible) proceed()
      else halt()
    },
    { threshold: 0.25 },
  ).observe(stage)
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) halt()
    else proceed()
  })
}
