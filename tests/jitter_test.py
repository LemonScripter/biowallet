import time
import statistics
import os

def measure_jitter(iterations=1000):
    deltas = []
    for _ in range(iterations):
        t1 = time.perf_counter()
        # Small busy wait
        x = 0
        for i in range(100):
            x += i
        t2 = time.perf_counter()
        deltas.append(t2 - t1)
    
    avg = sum(deltas) / len(deltas)
    jitter = statistics.stdev(deltas)
    return avg * 1e9, jitter * 1e9 # Convert to nanoseconds

if __name__ == "__main__":
    print(f"--- MetaSpace Latency Benchmark (PID: {os.getpid()}) ---")
    
    print("Step 1: Measuring Baseline (Normal Mode)...")
    avg1, jit1 = measure_jitter()
    print(f"Avg: {avg1:.2f} ns | Jitter: {jit1:.2f} ns")
    
    print("\n[ACTION] Please ensure metaspace_supervisor.exe is running!")
    print("Measuring again in 5 seconds...")
    time.sleep(5)
    
    avg2, jit2 = measure_jitter()
    print(f"Step 2: Measuring with Supervisor...")
    print(f"Avg: {avg2:.2f} ns | Jitter: {jit2:.2f} ns")
    
    if jit1 > 0:
        improvement = ((jit1 - jit2) / jit1) * 100
        print(f"\nJitter Reduction: {improvement:.2f}%")
        if improvement > 0:
            print("STATUS: MetaSpace is stabilizing the system.")
