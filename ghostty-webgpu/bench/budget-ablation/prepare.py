import hashlib
import json
import pathlib
import shutil
import sys
import tarfile

HERE = pathlib.Path(__file__).resolve().parent
BUNDLE = pathlib.Path(sys.argv[1]).resolve()
WAVE = pathlib.Path(sys.argv[2]).resolve()
SOURCE = WAVE / 'lanes/r3-unicode/shared-bundle-r07-u11-current'
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
for name in ['display-helpers.mjs', 'fixture.mjs', 'measure.mjs', 'raster-settlement.mjs', 'reader-capability-guard.mjs', 'rusage.py']:
    shutil.copy2(SOURCE / name, BUNDLE / name)
shutil.copy2(WAVE / 'kit/comparison-counters.mjs', BUNDLE / 'comparison-counters.mjs')
shutil.copy2(HERE / 'proof.mjs', BUNDLE / 'proof.mjs')
(BUNDLE / 'tooling').mkdir(exist_ok=True)
for name in ['build.ts', 'overlays.ts', 'prepare.py', 'proof.mjs', 'local-proof.mjs']:
    shutil.copy2(HERE / name, BUNDLE / 'tooling' / name)
s = (SOURCE / 'driver.mjs').read_text()
a = s.index('const actors = ')
b = s.index('\nassert.equal(process.platform', a)
s = s[:a] + "const actors = arms" + s[b:]
s = s.replace("import { nativeSnapshot, nativeDelta, assertWork } from './measure.mjs'", "import { nativeSnapshot, nativeDelta } from './measure.mjs'\nimport { arms, assertArmWork as assertWork } from './proof.mjs'")
s = s.replace("const save = () => writeFile(join(out, 'index.json'), JSON.stringify(result, null, 2) + '\\n')", "let emitted = 0\nconst save = async () => {\n  await writeFile(join(out, 'index.json'), JSON.stringify(result, null, 2) + '\\n')\n  while (emitted < result.runs.length && result.runs[emitted].status === 'complete') {\n    const row = result.runs[emitted++]\n    console.log(JSON.stringify({ event: 'window-complete', id: result.id, index: row.index, actor: row.actor, workload: row.workload, contentSha256: row.contentSha256, inputSha256: row.inputSha256, cellLayoutSha256: row.cellLayoutSha256 }))\n  }\n}")
s = s.replace("    row.correctness = await page.evaluate(() => window.__compare.correctness())", "    for (const target of row.geometry) {\n      const backing = target.geometry.filter(canvas => canvas.renderingCanvas)\n      assert.equal(backing.length, actors[actor].parserOnly ? 0 : 1)\n      for (const canvas of backing) { assert.equal(canvas.width, 560); assert.equal(canvas.height, 456); assert.equal(canvas.visible, true) }\n    }\n    row.correctness = await page.evaluate(() => window.__compare.correctness())")
s = s.replace("    row.content = await page.evaluate(() => window.__direct.content())", "    row.inputs = await page.evaluate(() => window.__direct.inputProof())\n    for (const input of row.inputs) assert.equal(input.calls, protocol.ticks + 1)\n    assert.equal(new Set(row.inputs.map(input => input.framedInputSha256)).size, 1)\n    row.inputSha256 = row.inputs[0].framedInputSha256\n    row.content = await page.evaluate(() => window.__direct.content())")
s = s.replace("text: target.publicText.map(line => line.trimEnd()), ", '')
s = s.replace("    row.screenshotSettlement = await settleScreenshot(page)", "    if (!actors[actor].parserOnly && !actors[actor].noGpu) row.screenshotSettlement = await settleScreenshot(page)")
s = s.replace("    for (const actor of protocol.order) assert.equal(new Set(completed.filter(row => row.actor === actor).map(row => row.screenshotSha256)).size, 1, 'Same-renderer complete PNG differs')", "    assert.equal(new Set(completed.map(row => row.inputSha256)).size, 1, 'Actual public byte streams or boundaries differ')\n    const nativeRender = completed.filter(row => row.actor.startsWith('G') && !actors[row.actor].parserOnly)\n    assert.equal(new Set(nativeRender.map(row => row.measured.budgetAfter.nativeFrames - row.measured.budgetBefore.nativeFrames)).size, 1, 'Native frame work differs across rendering arms')\n    for (const actor of protocol.order) if (!actors[actor].parserOnly && !actors[actor].noGpu) assert.equal(new Set(completed.filter(row => row.actor === actor).map(row => row.screenshotSha256)).size, 1, 'Same-renderer complete PNG differs')")
# Public copied text intentionally differs in SKIP. The independent retained native/cell oracles remain mandatory.
(BUNDLE / 'driver.mjs').write_text(s)
files = {str(p.relative_to(BUNDLE)): sha(p) for p in sorted(BUNDLE.rglob('*')) if p.is_file() and p.name not in ['seal.json', 'shared.tar.gz'] and p.parent.name != '__pycache__'}
(BUNDLE / 'seal.json').write_text(json.dumps({'files': files, 'scope': 'Diagnostic-only six-arm CPU budget on current main, exact R07 bytes and R07-u11 owner oracle.'}, indent=2) + '\n')
with tarfile.open(BUNDLE / 'shared.tar.gz', 'w:gz') as archive:
    for name in [*files, 'seal.json']:
        archive.add(BUNDLE / name, arcname=name, recursive=False)
print(json.dumps({'bundle': str(BUNDLE), 'archiveSha256': sha(BUNDLE / 'shared.tar.gz'), 'sealSha256': sha(BUNDLE / 'seal.json')}))
