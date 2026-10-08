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
        self.assertIn('actions/download-artifact@v4', deploy)
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
        self.assertIn('      - apps/web/src/**\n', workflow)
        self.assertIn('      - ghostty-webgpu/*.wasm\n', workflow)
        self.assertIn('      - hotkeys/packages/*/src/**\n', workflow)
        self.assertIn('      - editor/scripts/build-package.ts\n', workflow)
        self.assertIn("      - '!**/*.test.*'\n", workflow)
        self.assertNotIn("      - '!**/*.md'\n", workflow)

    def test_dotfile_deny_precedes_site_location(self):
        config = Path(__file__).with_name('nginx.conf').read_text()
        self.assertLess(config.index('location ~ /\\.'), config.index('location ~ ^/(fregat|singapore|ghostty-webgpu)/'))
        for header in ('Strict-Transport-Security', 'Referrer-Policy', 'X-Content-Type-Options', 'Content-Security-Policy', 'X-Frame-Options'):
            self.assertIn('add_header ' + header, config)
        self.assertNotIn('includeSubDomains', config)


if __name__ == '__main__':
    unittest.main()
