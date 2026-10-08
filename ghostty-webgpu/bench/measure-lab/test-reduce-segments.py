import importlib.util
import math
import pathlib
import unittest

spec = importlib.util.spec_from_file_location('segments', pathlib.Path(__file__).with_name('reduce-segments.py'))
segments = importlib.util.module_from_spec(spec)
spec.loader.exec_module(segments)


class ReductionTest(unittest.TestCase):
    def test_symmetric_control_covers_one(self):
        result = segments.interval([-.01, .01, -.02, .02, -.03, .03])
        self.assertEqual(result['ratio'], 1)
        self.assertLess(result['ci95'][0], 1)
        self.assertGreater(result['ci95'][1], 1)

    def test_arm_swap_inverts_interval(self):
        values = [.01, .012, .008, .009, .011, .01]
        forward = segments.interval(values)
        reverse = segments.interval([-v for v in values])
        self.assertAlmostEqual(reverse['ratio'], 1 / forward['ratio'])
        self.assertAlmostEqual(reverse['ci95'][0], 1 / forward['ci95'][1])
        self.assertAlmostEqual(reverse['ci95'][1], 1 / forward['ci95'][0])

    def test_power_requires_more_blocks_for_smaller_effect(self):
        self.assertGreater(segments.required_blocks(.02, .01), segments.required_blocks(.02, .02))
        self.assertGreater(segments.required_blocks(.04, .01), segments.required_blocks(.02, .01))
        self.assertEqual(segments.required_blocks(0, .01), 2)

    def test_known_one_percent_effect(self):
        result = segments.interval([math.log(1.01)] * 6)
        self.assertAlmostEqual(result['ratio'], 1.01)
        self.assertAlmostEqual(result['ci95'][0], 1.01)
        self.assertAlmostEqual(result['ci95'][1], 1.01)

    def test_constant_series_has_no_lag_estimate(self):
        self.assertIsNone(segments.lag_one([0] * 6))


if __name__ == '__main__':
    unittest.main()
