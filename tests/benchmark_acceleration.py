import time
import math
import random
import sys
import os

# Add src to path
sys.path.append(os.path.join(os.path.dirname(__file__), '..', 'src'))
from metaspace_logic_engine import ComputationalHomeostasis

def simulate_complex_math(x, y, z):
    """
    Szimulálunk egy nehéz számítást.
    A 'time.sleep' reprezentálja a CPU terhelést.
    """
    time.sleep(0.01) 
    return math.sin(x) * math.cos(y) + math.sqrt(abs(z))

def run_benchmark(iterations=100, redundancy_rate=0.9):
    engine = ComputationalHomeostasis()
    
    print(f"--- MetaSpace Benchmark: {iterations} iteráció, {redundancy_rate*100}% redundancia ---")
    
    # 1. Hagyományos futtatás
    print("\n[1/2] Hagyományos futtatás...")
    start_raw = time.time()
    
    base_inputs = [(random.uniform(0, 100), random.uniform(0, 100), random.uniform(0, 100)) for _ in range(max(1, int(iterations * (1-redundancy_rate))))]
    test_inputs = []
    for _ in range(iterations):
        if random.random() < redundancy_rate:
            test_inputs.append(random.choice(base_inputs))
        else:
            new_in = (random.uniform(0, 100), random.uniform(0, 100), random.uniform(0, 100))
            test_inputs.append(new_in)
            base_inputs.append(new_in)

    for inp in test_inputs:
        simulate_complex_math(*inp)
    
    end_raw = time.time()
    raw_duration = end_raw - start_raw
    print(f"Hagyományos idő: {raw_duration:.4f} másodperc")

    # 2. MetaSpace Accelerated futtatás
    print("\n[2/2] MetaSpace Gyorsított futtatás...")
    start_acc = time.time()
    
    for inp in test_inputs:
        engine.process(list(inp), simulate_complex_math)
    
    end_acc = time.time()
    acc_duration = end_acc - start_acc
    print(f"MetaSpace idő: {acc_duration:.4f} másodperc")

    # Eredmények elemzése
    speedup = raw_duration / acc_duration if acc_duration > 0 else raw_duration * 1000
    print("\n" + "="*40)
    print(f"EREDMÉNY:")
    print(f"Gyorsulási faktor: {speedup:.2f}x")
    print(f"Megspórolt CPU idő: {raw_duration - acc_duration:.4f}s")
    
    if speedup >= 30.0:
        print("ÁLLAPOT: METASPACE V4 SZINTŰ GYORSULÁS (Holy Grail)")
    print("="*40)

if __name__ == "__main__":
    run_benchmark(iterations=200, redundancy_rate=0.95)
