import unittest
import math
import sys
import os

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))
from metaspace_logic_engine import ComputationalHomeostasis, DEFAULT_TOLERANCE

class TestTolerance(unittest.TestCase):
    def setUp(self):
        self.engine = ComputationalHomeostasis()
        self.func = lambda x: x * 2

    def test_tolerance_hit(self):
        val1 = 10.0
        # Change is smaller than tolerance/2 (rounding behavior)
        val2 = 10.0 + (DEFAULT_TOLERANCE / 3.0) 
        
        # Run 1
        res1 = self.engine.process([val1], self.func)
        
        # Run 2 (Should use cache because hash is identical)
        # We can't easily check internal state, but we can mock or check execution time
        # Or check if result is exactly the same object if we returned an object, 
        # but here we return a number.
        
        # Let's inspect the DNA directly
        dna1 = self.engine.cache.generate_dna([val1])
        dna2 = self.engine.cache.generate_dna([val2])
        
        print(f"Val1: {val1}, DNA: {dna1}")
        print(f"Val2: {val2}, DNA: {dna2}")
        
        self.assertEqual(dna1, dna2, "DNA should be identical for values within tolerance")

    def test_tolerance_miss(self):
        val1 = 10.0
        # Change is larger than tolerance
        val2 = 10.0 + (DEFAULT_TOLERANCE * 2.0)
        
        dna1 = self.engine.cache.generate_dna([val1])
        dna2 = self.engine.cache.generate_dna([val2])
        
        print(f"Val1: {val1}, DNA: {dna1}")
        print(f"Val2: {val2}, DNA: {dna2}")
        
        self.assertNotEqual(dna1, dna2, "DNA should differ for values outside tolerance")

if __name__ == '__main__':
    unittest.main()
