import json
import os
import re
import subprocess
import tempfile
from pathlib import Path
import unittest


class DeploymentTests(unittest.TestCase):
    def test_cloudflare_config_uses_the_fregat_domain(self):
        source = Path(__file__).parent
        config = json.loads(re.sub(r',\s*([}\]])', r'\1', (source / 'wrangler.fregat.jsonc').read_text()))
        self.assertEqual(config['routes'], [{'pattern': 'fregat.shaulavo.dev', 'custom_domain': True}])
        self.assertFalse(config['workers_dev'])
        self.assertFalse(config['preview_urls'])
        self.assertEqual(config['assets']['directory'], './dist/fregat')
        self.assertEqual(config['assets']['html_handling'], 'auto-trailing-slash')
        self.assertEqual(config['assets']['not_found_handling'], 'none')
        self.assertNotIn('main', config)
        self.assertEqual(sorted(path.name for path in source.glob('wrangler.*.jsonc')), ['wrangler.fregat.jsonc'])
        scripts = json.loads((source.parent / 'package.json').read_text())['scripts']
        self.assertEqual(scripts['product-sites:deploy'], 'wrangler deploy --config product-sites/wrangler.fregat.jsonc')

    def run_build(self, root, selection=None, mode=None):
        scripts = root / 'scripts/product-sites'
        scripts.mkdir(parents=True)
        source = Path(__file__).parent
        for name in ('build.sh', '_headers'):
            (scripts / name).write_text((source / name).read_text())
        site = root / 'apps/site/dist'
        site.mkdir(parents=True)
        (site / 'index.html').write_text('Fregat landing page')
        binary = root / 'bin'
        binary.mkdir()
        bun = binary / 'bun'
        bun.write_text('#!/bin/sh\nprintf "%s %s\\n" "$SITE_ORIGIN" "$*" >> "$BUILD_LOG"\nexit 0\n')
        bun.chmod(0o755)
        log = root / 'build.log'
        env = {**os.environ, 'PATH': f'{binary}{os.pathsep}{os.environ["PATH"]}', 'BUILD_LOG': str(log)}
        output = root / 'output'
        command = ['bash', str(scripts / 'build.sh'), str(output)]
        if selection is not None:
            command.append(selection)
        if mode is not None:
            command.append(mode)
        result = subprocess.run(command, env=env, capture_output=True, text=True)
        return result, output, log

    def test_build_needs_only_fregat_sources_and_keeps_headers(self):
        with tempfile.TemporaryDirectory(prefix='fregat-site-build-') as directory:
            result, output, log = self.run_build(Path(directory))
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(log.read_text().splitlines(), [
                ' scripts/ci/packages.mjs build ["site"]',
                'https://fregat.shaulavo.dev run --cwd apps/site site:build',
            ])
            self.assertEqual((output / 'fregat/index.html').read_text(), 'Fregat landing page')
            self.assertEqual((output / 'fregat/_headers').read_text(), (Path(__file__).parent / '_headers').read_text())
            self.assertEqual(sorted(path.name for path in output.iterdir()), ['fregat'])

    def test_ci_build_verifies_imported_prerequisites(self):
        with tempfile.TemporaryDirectory(prefix='fregat-site-reuse-') as directory:
            result, _, log = self.run_build(Path(directory), 'fregat', '--reuse-workspace-builds')
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('scripts/ci/build-reuse.mjs verify-site ["site"]', log.read_text())
            self.assertNotIn('packages.mjs build', log.read_text())

    def test_rejects_unknown_site_before_building(self):
        with tempfile.TemporaryDirectory(prefix='fregat-site-selection-') as directory:
            result, output, log = self.run_build(Path(directory), 'unknown')
            self.assertEqual(result.returncode, 2)
            self.assertFalse(output.exists())
            self.assertFalse(log.exists())

    def test_only_content_hashed_output_has_immutable_cache_headers(self):
        source = (Path(__file__).parent / '_headers').read_text()
        rules = {}
        path = None
        for line in source.splitlines():
            if not line.strip():
                continue
            if not line.startswith(' '):
                path = line
                rules[path] = {}
                continue
            name, value = line.strip().split(':', 1)
            rules[path][name.lower()] = value.strip()
        immutable = {path: headers['cache-control'] for path, headers in rules.items()
                     if 'cache-control' in headers}
        self.assertEqual(immutable, {'/_astro/*': 'public, max-age=31536000, immutable'})
        self.assertNotIn('cache-control', rules['/*'])
        self.assertEqual(rules['/*']['strict-transport-security'], 'max-age=31536000')
        self.assertEqual(rules['/*']['x-content-type-options'], 'nosniff')
        self.assertEqual(rules['/*']['x-frame-options'], 'SAMEORIGIN')

    def test_fregat_build_only_builds_the_landing_page(self):
        root = Path(__file__).resolve().parents[2]
        build = (root / 'scripts/build-site.ts').read_text()
        self.assertIn("['bun', 'astro', 'build']", build)
        for retired in ('demo', 'msw', 'apps/web', 'vite'):
            self.assertNotIn(retired, build)


if __name__ == '__main__':
    unittest.main()
