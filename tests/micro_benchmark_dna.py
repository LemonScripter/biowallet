import time
import struct
import hashlib
import random

def python_dna_gen(state_vector, tolerance=1e-4):
    normalized_data = bytearray()
    for val in state_vector:
        factor = 1.0 / tolerance
        val = round(val * factor) / factor
        normalized_data.extend(struct.pack('d', val))
    return hashlib.sha256(normalized_data).hexdigest()

def run_micro_benchmark():
    vector_size = 100
    iterations = 5000 
    test_vector = [random.uniform(0, 100) for _ in range(vector_size)]

    print(f"--- MetaSpace Micro-Benchmark: DNA Generation Speed ---")
    print(f"Vector size: {vector_size} floats")
    print(f"Iterations: {iterations}")

    start = time.time()
    for _ in range(iterations):
        python_dna_gen(test_vector)
    end = time.time()
    py_time = end - start
    
    # Assembly estimation based on cycle counts (AVX-512)
    # 100 floats / 16 (SIMD width) = 7 iterations
    # 7 iterations * 10 cycles = 70 cycles
    # 70 cycles @ 3GHz = 23 nanoseconds
    cpp_asm_time_per_iter = 0.00000005 # 50ns (conservative)
    cpp_asm_total_time = iterations * cpp_asm_time_per_iter
    
    print(f"Python time: {py_time:.4f}s")
    print(f"Assembly estimated time: {cpp_asm_total_time:.6f}s")
    
    speedup = py_time / cpp_asm_total_time
    print(f"Theoretical Logic Speedup: {speedup:.2f}x")

if __name__ == "__main__":
    run_micro_benchmark()
