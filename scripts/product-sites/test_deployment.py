import os
import re
import subprocess
import tempfile
from pathlib import Path
import unittest


class DeploymentTests(unittest.TestCase):
    def test_build_job_cannot_receive_deployment_key(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github/workflows/product-sites.yml').read_text()
        build, deploy = workflow.split('\n  deploy:\n')
        self.assertNotIn('secrets.', build)
        self.assertIn('actions/upload-artifact@v4', build)
        self.assertIn('needs: build', deploy)
        self.assertIn('environment: production', deploy)
        self.assertIn('actions/download-artifact@d3f86a106a0bac45b974a628896c90dbdf5c8093', deploy)
        for action in re.findall(r'uses: ([^\s]+)', deploy):
            self.assertRegex(action, r'@[0-9a-f]{40}$')
        self.assertNotIn('actions/checkout', deploy)
        self.assertNotIn('bun ', deploy)
        self.assertNotIn('tar -x', deploy)
        self.assertIn('secrets.PRODUCT_SITES_DEPLOY_KEY', deploy)

    def test_paths_target_build_inputs(self):
        root = Path(__file__).resolve().parents[2]
        workflow = (root / '.github/workflows/product-sites.yml').read_text()
        self.assertNotIn('      - apps/web/**\n', workflow)
        self.assertNotIn('      - packages/**\n', workflow)
        self.assertNotIn('      - ghostty-webgpu/**\n', workflow)
        self.assertNotIn('      - apps/web/src/**\n', workflow)
        self.assertNotIn('apps/web/demo', workflow)
        self.assertIn('      - ghostty-webgpu/*.wasm\n', workflow)
        self.assertIn('      - hotkeys/packages/*/src/**\n', workflow)
        self.assertIn('      - editor/scripts/build-package.ts\n', workflow)
        self.assertIn("      - '!**/*.test.*'\n", workflow)
        self.assertNotIn("      - '!**/*.md'\n", workflow)

    def test_build_keeps_docs_and_repository_demo_at_separate_routes(self):
        with tempfile.TemporaryDirectory(prefix='product-sites-build-') as directory:
            root = Path(directory)
            scripts = root / 'scripts/product-sites'
            scripts.mkdir(parents=True)
            source = Path(__file__).parent
            (scripts / 'build.sh').write_text((source / 'build.sh').read_text())
            (scripts / 'index.html').write_text('Project index')
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
            self.assertIn('/singapore/demo/ x turbo run build --filter=@singapore-editor/example-app', commands)
            self.assertIn('run --cwd editor/site build --base /singapore/', commands)
            self.assertEqual((output / 'singapore/index.html').read_text(), 'editor/site')
            self.assertEqual((output / 'singapore/demo/index.html').read_text(), 'editor/examples/app')
            log.write_text('')
            selected = root / 'terminal-only'
            subprocess.run(['bash', str(scripts / 'build.sh'), str(selected), 'ghostty-webgpu'], env=env, check=True)
            self.assertEqual((selected / 'ghostty-webgpu/index.html').read_text(), 'ghostty-webgpu/site')
            self.assertFalse((selected / 'singapore').exists())
            self.assertFalse((selected / 'fregat').exists())
            self.assertNotIn('editor/site', log.read_text())
            self.assertNotIn('apps/site', log.read_text())


    def test_fregat_build_only_builds_the_landing_page(self):
        root = Path(__file__).resolve().parents[2]
        build = (root / 'scripts/build-site.ts').read_text()
        self.assertIn("['bun', 'astro', 'build']", build)
        for retired in ('demo', 'msw', 'apps/web', 'vite'):
            self.assertNotIn(retired, build)

    def test_dotfile_deny_precedes_site_location(self):
        config = Path(__file__).with_name('nginx.conf').read_text()
        self.assertLess(config.index('location ~ /\\.'), config.index('location ~ ^/(fregat|singapore|ghostty-webgpu)/'))
        for header in ('Strict-Transport-Security', 'Referrer-Policy', 'X-Content-Type-Options', 'Content-Security-Policy', 'X-Frame-Options'):
            self.assertIn('add_header ' + header, config)
        self.assertNotIn('includeSubDomains', config)


if __name__ == '__main__':
    unittest.main()
