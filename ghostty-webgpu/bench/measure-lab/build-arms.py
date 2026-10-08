import argparse
import hashlib
import io
import json
import pathlib
import subprocess
import tarfile

parser = argparse.ArgumentParser()
parser.add_argument('--output', required=True, type=pathlib.Path)
parser.add_argument('--fixture-source', required=True, type=pathlib.Path)
parser.add_argument('--logs', required=True, type=pathlib.Path)
parser.add_argument('--arm', action='append', required=True, help='NAME=REVISION or NAME=REVISION,BRIDGE_PATH')
args = parser.parse_args()
args.output = args.output.resolve()
args.fixture_source = args.fixture_source.resolve()
args.logs = args.logs.resolve()
repo = pathlib.Path(__file__).resolve().parents[3]
args.output.mkdir(parents=True, exist_ok=False)
headers = pathlib.Path(subprocess.check_output(['node', '-p', 'process.execPath'], text=True).strip()).parent.parent / 'include/node'
subprocess.run(['cc', '-O2', '-shared', '-fPIC', f'-I{headers}', str(pathlib.Path(__file__).with_name('counters.c')), '-o', str(args.output / 'counters.node')], check=True, cwd=repo)
subprocess.run(['bun', 'build', str(args.fixture_source), '--target=node', '--outfile', str(args.output / 'fixtures.mjs')], check=True, cwd=repo)
(args.output / 'logs.txt').write_bytes(args.logs.read_bytes())
manifest = {'fixtureSha256': hashlib.sha256(args.fixture_source.read_bytes()).hexdigest(), 'logsSha256': hashlib.sha256(args.logs.read_bytes()).hexdigest(), 'counterSourceSha256': hashlib.sha256(pathlib.Path(__file__).with_name('counters.c').read_bytes()).hexdigest(), 'counterBinarySha256': hashlib.sha256((args.output / 'counters.node').read_bytes()).hexdigest(), 'fixtureModuleSha256': hashlib.sha256((args.output / 'fixtures.mjs').read_bytes()).hexdigest(), 'node': subprocess.check_output(['node', '--version'], text=True).strip(), 'counterBuild': ['cc', '-O2', '-shared', '-fPIC', 'matching-node-headers'], 'arms': {}}
for definition in args.arm:
    name, specification = definition.split('=', 1)
    parts = specification.split(',', 1)
    revision = subprocess.check_output(['git', '-C', str(repo), 'rev-parse', parts[0]], text=True).strip()
    root = args.output / name
    root.mkdir(exist_ok=False)
    archive = subprocess.check_output(['git', '-C', str(repo), 'archive', revision, 'ghostty-webgpu/src', 'ghostty-webgpu/bridge.wasm', 'ghostty-webgpu/ghostty-vt.wasm'])
    with tarfile.open(fileobj=io.BytesIO(archive)) as source:
        source.extractall(root, filter='data')
    package = root / 'ghostty-webgpu'
    bridge = package / 'bridge.wasm'
    if len(parts) > 1:
        bridge.write_bytes(pathlib.Path(parts[1]).read_bytes())
    entry = root / 'imports.ts'
    entry.write_text("\n".join([
        "export { GhosttyRuntime } from './ghostty-webgpu/src/core/runtime.ts'",
        "export { FrameObserver } from './ghostty-webgpu/src/render/frame-observer.ts'",
        "export { WebGlTextPass } from './ghostty-webgpu/src/render/webgl/text-pass.ts'",
        "export { GlyphAtlas } from './ghostty-webgpu/src/render/atlas/atlas.ts'",
        "export { buildZigFrame } from './ghostty-webgpu/src/render/atlas/zig-glyphs.ts'",
        "export { defaultRendererTheme } from './ghostty-webgpu/src/render/instances/types.ts'",
        "export { CanvasRowPainter } from './ghostty-webgpu/src/render/canvas/painter.ts'",
    ]))
    subprocess.run(['bun', 'build', str(entry), '--target=node', '--sourcemap=external', '--outdir', str(root), '--entry-naming=runtime.mjs'], check=True, cwd=repo)
    manifest['arms'][name] = {'revision': revision, 'bridgeSha256': hashlib.sha256(bridge.read_bytes()).hexdigest(), 'wasmSha256': hashlib.sha256((package / 'ghostty-vt.wasm').read_bytes()).hexdigest(), 'moduleSha256': hashlib.sha256((root / 'runtime.mjs').read_bytes()).hexdigest()}
(args.output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps({'output': str(args.output), 'arms': manifest['arms']}))
