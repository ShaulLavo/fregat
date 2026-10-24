// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('executes default palette registration from a minified package consumer bundle', () => {
  const script = `
    import { build } from 'vite';
    import { Window } from 'happy-dom';
    const entry = '\\0diff-theme-consumer';
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [{
        name: 'diff-theme-consumer',
        resolveId(id) { if (id === entry) return id; },
        load(id) {
          if (id !== entry) return;
          return ${JSON.stringify(`
            import { createDiffPlugin } from ${JSON.stringify(fileURLToPath(new URL('../../diff/dist/index.js', import.meta.url)))};
            import { applyEditorTheme } from ${JSON.stringify(fileURLToPath(new URL('../dist/public/rendering.js', import.meta.url)))};
            export function paint(element) {
              createDiffPlugin({ mode: 'document' });
              applyEditorTheme(element, { type: 'dark' });
            }
          `)};
        }
      }],
      build: { write: false, minify: true, rollupOptions: {
        input: entry, preserveEntrySignatures: 'strict',
        output: { format: 'es', codeSplitting: false }
      } }
    });
    const chunks = (Array.isArray(result) ? result : [result])
      .flatMap(build => build.output).filter(output => output.type === 'chunk');
    if (chunks.length !== 1) throw new Error('Expected one executable consumer chunk');
    const bundle = await import('data:text/javascript;base64,' + Buffer.from(chunks[0].code).toString('base64'));
    const window = new Window();
    const element = window.document.createElement('div');
    window.document.body.append(element);
    bundle.paint(element);
    console.log(JSON.stringify({
      added: window.getComputedStyle(element).getPropertyValue('--editor-diff-added').trim(),
      hunk: window.getComputedStyle(element).getPropertyValue('--editor-diff-hunk-foreground').trim(),
      placeholder: window.getComputedStyle(element).getPropertyValue('--editor-diff-placeholder-bg').trim()
    }));
    await window.happyDOM.close();
  `
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8',
    maxBuffer: 8 * 1024 * 1024,
  })
  expect(JSON.parse(output)).toEqual({
    added: '#5ecc71',
    hunk: '#9cdcfe',
    placeholder: 'color-mix(in srgb, #1e1e1e 92%, #ffffff)',
  })
})
