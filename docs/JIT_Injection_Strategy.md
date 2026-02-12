# JIT Injection Strategy: The "Neuronal Lace"

## 1. Objective
To seamlessly redirect standard computation calls (e.g., Matrix Multiplication, Physics Update) from User Mode applications to the `MetaCore` Kernel Driver without recompiling the target application.

## 2. Methodology: Inline Hooking (Trampolining)

We will use a technique similar to Microsoft Detours or MinHook.

### The Mechanism:
1.  **Target Identification:** The injector scans the target process memory for "Hot Functions" (functions consuming high CPU).
2.  **The Hook (The "Jump"):** 
    -   We overwrite the first 5 bytes of the target function with a `JMP` instruction.
    -   `JMP <Address_of_MetaSpace_Shim>`
3.  **The Trampoline (Original Function):**
    -   We save the original overwritten bytes to a new memory location (The Trampoline).
    -   We append a `JMP` back to the rest of the original function.
    -   This allows us to call the original function if we get a **Cache Miss**.

## 3. Architecture

### A. The Injector (`metaspace_injector.exe`)
-   Scans running processes.
-   Uses `CreateRemoteThread` and `LoadLibrary` to force the target process to load our Shim DLL.

### B. The Shim DLL (`metaspace_shim.dll`)
-   Lives inside the target application's memory space.
-   **OnInit:** Sets up the hooks on identified functions.
-   **The Hook Function:**
    1.  Captures arguments (Registers + Stack).
    2.  Sends data to Kernel Driver via `DeviceIoControl`.
    3.  **IF Cache Hit:** Returns result immediately (skips original function).
    4.  **IF Cache Miss:** Calls the *Trampoline* (Original Function), captures the result, updates the Kernel Cache, and returns.

## 4. Safety Protocols (Anti-Crash)
-   **Atomic Patching:** Use `InterlockedExchange` or pause the thread to ensure we don't patch while the CPU is executing those exact bytes.
-   **Reentrancy Protection:** Ensure our hook doesn't call itself recursively.

## 5. Visual Flow

[ Target App ]  ---> [ JMP Hook ] ---> [ MetaSpace Shim ]
                                              |
                                     (IOCTL to Kernel)
                                              |
                                              v
                                     [ MetaCore Driver ]
                                     (AVX Comparison)
                                     
                                     (Return Result or Compute Instruction)
