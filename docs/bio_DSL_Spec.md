# .bio Domain Specific Language (DSL) Specification

## Overview

The `.bio` DSL allows developers to describe the invariants and "homeostatic" properties of their software components to the MetaSpace Logic Engine. By defining these properties, the engine can safely skip redundant computations.

## Syntax Structure

### 1. Global Scope
Defines default parameters for the entire module.

```bio
scope Global {
    tolerance: 0.001      // Default epsilon for float comparisons
    timeout: 100ms        // Max time for Z3 verification
    memory_limit: 512MB   // Max RAM usage for cache
}
```

### 2. Entity Definition
Defines a specific computational unit (function, loop, object method).

```bio
entity <EntityName> {
    // State variables to monitor
    state: <Type> <Name>, ...
    
    // Homeostasis Rules (Fast Path)
    homeostasis:
        <Condition> -> <Action>
    
    // Invariants (Z3 Verification Path)
    invariant:
        <LogicalExpression>
}
```

### 3. Types
Supported types for state variables:
-   `float`, `double`
-   `int`, `long`
-   `bool`
-   `vector<T>`
-   `matrix<T>`

### 4. Homeostasis Rules
Simple conditions that trigger immediate action (SKIP or COMPUTE).
-   `delta(<Variable>)`: The change in value since the last execution.
-   `prev(<Variable>)`: The value from the previous execution.
-   Operators: `<`, `>`, `==`, `!=`, `<=`, `>=`
-   Actions: `SKIP` (return cached result), `COMPUTE` (force execution).

### 5. Invariants
Logical expressions that must hold true for the state transition to be valid. These are translated into Z3 constraints.
-   Mathematical operators: `+`, `-`, `*`, `/`, `^`, `%`
-   Logical operators: `AND`, `OR`, `NOT`, `IMPLIES`
-   Quantifiers: `forall`, `exists` (limited support)

## Example: Physics Simulation

```bio
scope PhysicsSim {
    tolerance: 1e-4
    timeout: 50ms
}

entity ObjectUpdate {
    state: vector<float> Position, vector<float> Velocity, float Mass
    
    // If the object hasn't moved significantly, skip physics update
    homeostasis:
        delta(Position) < 0.001 AND delta(Velocity) < 0.001 -> SKIP
    
    // Conservation of Energy (Simplified) - Z3 checks this if homeostasis check passes but needs verification
    invariant:
        0.5 * Mass * (Velocity * Velocity) + (9.81 * Mass * Position.y) == prev(Energy)
}
```

## Example: Matrix Multiplication

```bio
scope LinearAlgebra {
    tolerance: 0.0
}

entity MatMul {
    state: matrix<float> A, matrix<float> B
    
    // If input matrices are identical to cached version, skip
    homeostasis:
        hash(A) == prev(hash(A)) AND hash(B) == prev(hash(B)) -> SKIP
}
```
