# Kernel-User Communication Protocol: "The Pulse"

## 1. Objective
Enable high-speed synchronization between the User-Mode Logic Engine (Verification) and the Kernel-Mode Driver (Execution) without introducing system latency.

## 2. Shared Memory Model (Zero-Copy)

Instead of traditional IOCTL where data is copied back and forth, MetaSpace uses **Memory Mapping (MDL - Memory Descriptor Lists)**.

-   **The Vault:** A 512MB non-paged pool allocated by the Kernel.
-   **Visibility:** This memory is mapped into the User-Mode Logic Engine's address space.
-   **Structure:** A High-Density Hash Table.

### Data Entry Structure (128 bytes):
```c
struct CacheEntry {
    uint64_t dna_hash;       // The AVX-generated DNA
    double   result;         // The pre-calculated result
    uint32_t flags;          // VALID, PENDING, EXPIRED
    uint32_t access_count;   // For LRU eviction logic
    char     padding[96];    // Align to 128-byte cache line for CPU performance
};
```

## 3. The Asynchronous Workflow

1.  **Verification (User Mode):**
    -   The Logic Engine runs Z3 on a new state.
    -   If SAT (Verified), it calculates the `dna_hash`.
    -   It writes the `CacheEntry` directly into the mapped "Vault" memory.
2.  **Execution (Kernel Mode / Shim):**
    -   The `metaspace_shim` calls the Kernel Driver.
    -   The Driver checks the "Vault" using the `dna_hash`.
    -   Since the "Vault" is in physical RAM, the check is $O(1)$ and takes ~50-100 cycles.

## 4. Performance Guarantee
-   **No Context Switching:** The Kernel doesn't trigger a task switch to ask for data.
-   **Non-Blocking:** If a hash is not in the Vault, the system immediately proceeds to normal computation (Fail-Safe).
-   **CPU Affinity:** The Logic Engine is pinned to a specific core (e.g., Core 0) to avoid interrupting the performance-critical tasks on other cores.
