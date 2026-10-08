;(function () {
  const base = new URL('.', document.currentScript.src)
  window.SGEmbed = {
    mount(host, options) {
      const text = host.querySelector('pre')?.textContent ?? host.textContent
      const replica = window.SG?.mount(host, options)
      const listeners = new Set()
      let real = null
      let loading = null
      let latest = {
        mode: 'edit',
        line: 1,
        col: 1,
        lines: text.split('\n').length,
        highlightApi: false,
        ranges: 0,
        spans: 0,
        versions: 1,
        versionIndex: 0,
        branches: 0,
      }
      replica?.onChange((state) => {
        latest = state
        if (!real) listeners.forEach((fn) => fn(state))
      })
      function load() {
        if (loading) return loading
        host.dataset.embed = 'loading'
        const started = performance.now()
        loading = import(new URL('editor.js', base).href)
          .then(async (module) => {
            await Promise.all(
              module.styles.map(
                (file) =>
                  new Promise((resolve, reject) => {
                    const link = document.createElement('link')
                    link.rel = 'stylesheet'
                    link.href = new URL(file, base).href
                    link.onload = resolve
                    link.onerror = reject
                    document.head.append(link)
                  }),
              ),
            )
            const input = host.querySelector('textarea')
            real = module.mountReal(host, options, {
              text: input?.value ?? text,
              anchor:
                input?.selectionDirection === 'backward'
                  ? input.selectionEnd
                  : (input?.selectionStart ?? 0),
              head:
                input?.selectionDirection === 'backward'
                  ? input.selectionStart
                  : (input?.selectionEnd ?? 0),
              focused: document.activeElement === input,
              scroll: { top: input?.scrollTop ?? 0, left: input?.scrollLeft ?? 0 },
            })
            real.onChange((state) => {
              latest = state
              listeners.forEach((fn) => fn(state))
            })
            host.dataset.embed = 'ready'
            host.dataset.interactiveMs = String(performance.now() - started)
            host.dispatchEvent(new CustomEvent('singapore-ready', { bubbles: true }))
            return real
          })
          .catch((error) => {
            host.dataset.embed = 'failed'
            console.error('Singapore embed failed', error)
            throw error
          })
        return loading
      }
      const observer = new IntersectionObserver((entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return
        observer.disconnect()
        void load()
      })
      observer.observe(host)
      const act = (name, ...args) => load().then((editor) => editor[name](...args))
      return {
        onChange(fn) {
          listeners.add(fn)
          if (latest) fn(latest)
        },
        openMillion() {
          return act('openMillion')
        },
        closeMillion() {
          return act('closeMillion')
        },
        load(text) {
          return act('load', text)
        },
        setVersion(index) {
          return act('setVersion', index)
        },
        focus() {
          return act('focus')
        },
        get versions() {
          return (real ?? replica)?.versions ?? 1
        },
      }
    },
  }
})()
