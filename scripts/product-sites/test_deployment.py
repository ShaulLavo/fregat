import os
import re
import subprocess
import tempfile
from pathlib import Path
import unittest


class DeploymentTests(unittest.TestCase):
    def test_cloudflare_configs_are_assets_only_and_exact_domains(self):
        import json
        root = Path(__file__).resolve().parents[2]
        for site in ('fregat', 'singapore', 'ghostty'):
            source = (Path(__file__).parent / f'wrangler.{site}.jsonc').read_text()
            config = json.loads(re.sub(r',\s*([}\]])', r'\1', source))
            self.assertEqual(config['routes'], [{'pattern': f'{site}.shaulavo.dev', 'custom_domain': True}])
            self.assertEqual(config['assets']['not_found_handling'], 'none')
            self.assertFalse(config['workers_dev'])
            self.assertNotIn('main', config)
        self.assertFalse((root / '.github/workflows/product-sites.yml').exists())

    def test_build_keeps_docs_and_repository_demo_at_separate_routes(self):
        with tempfile.TemporaryDirectory(prefix='product-sites-build-') as directory:
            root = Path(directory)
            scripts = root / 'scripts/product-sites'
            scripts.mkdir(parents=True)
            source = Path(__file__).parent
            (scripts / 'build.sh').write_text((source / 'build.sh').read_text())
            (scripts / 'index.html').write_text('Project index')
            (scripts / '_headers').write_text((source / '_headers').read_text())
            for folder in ('apps/site', 'editor/site', 'editor/examples/app', 'ghostty-webgpu/site'):
                (root / folder / 'dist').mkdir(parents=True)
                (root / folder / 'package.json').write_text('{}')
                (root / folder / 'dist/index.html').write_text(folder)
            binary = root / 'bin'
            binary.mkdir()
            bun = binary / 'bun'
            bun.write_text('#!/bin/sh\nprintf "%s %s %s\\n" "$SITE_ORIGIN" "$VITE_BASE_PATH" "$*" >> "$BUILD_LOG"\n')
            bun.chmod(0o755)
            log = root / 'build.log'
            env = {**os.environ, 'PATH': f'{binary}{os.pathsep}{os.environ["PATH"]}', 'BUILD_LOG': str(log)}
            output = root / 'output'
            subprocess.run(['bash', str(scripts / 'build.sh'), str(output)], env=env, check=True)
            commands = log.read_text()
            self.assertIn('/demo/ x turbo run build --filter=@singapore-editor/example-app', commands)
            self.assertIn('https://singapore.shaulavo.dev  run --cwd editor/site build --base /', commands)
            self.assertIn('https://fregat.shaulavo.dev  run --cwd apps/site site:build', commands)
            self.assertIn('https://ghostty.shaulavo.dev  run --cwd ghostty-webgpu/site build --base /', commands)
            self.assertNotIn('/singapore/demo/', commands)
            self.assertEqual((output / 'singapore/index.html').read_text(), 'editor/site')
            for site in ('fregat', 'singapore', 'ghostty-webgpu'):
                self.assertEqual((output / site / '_headers').read_text(), (source / '_headers').read_text())
            self.assertEqual((output / 'singapore/demo/index.html').read_text(), 'editor/examples/app')
            log.write_text('')
            selected = root / 'terminal-only'
            subprocess.run(['bash', str(scripts / 'build.sh'), str(selected), 'ghostty-webgpu'], env=env, check=True)
            self.assertEqual((selected / 'ghostty-webgpu/index.html').read_text(), 'ghostty-webgpu/site')
            self.assertFalse((selected / 'singapore').exists())
            self.assertFalse((selected / 'fregat').exists())
            self.assertNotIn('editor/site', log.read_text())
            self.assertNotIn('apps/site', log.read_text())


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
        self.assertEqual(immutable, {
            '/_astro/*': 'public, max-age=31536000, immutable',
            '/demo/assets/*': 'public, max-age=31536000, immutable',
        })
        self.assertNotIn('cache-control', rules['/*'])

    def test_fregat_build_only_builds_the_landing_page(self):
        root = Path(__file__).resolve().parents[2]
        build = (root / 'scripts/build-site.ts').read_text()
        self.assertIn("['bun', 'astro', 'build']", build)
        for retired in ('demo', 'msw', 'apps/web', 'vite'):
            self.assertNotIn(retired, build)



if __name__ == '__main__':
    unittest.main()
