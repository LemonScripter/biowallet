#include "metaspace_core.hpp"
#include <cmath>
#include <sstream>
#include <iomanip>
#include <iostream>
#include <cstring>

namespace MetaSpace {

    // --- TopologicalCache Implementation ---

    std::string TopologicalCache::GenerateDNA(const std::vector<double>& state) {
        if (state.empty()) return "0";

        // High-performance C++ fallback (FNV-1a inspired hash)
        uint64_t hash = 0xcbf29ce484222325ULL;
        for (double val : state) {
            // Normalize
            double normalized = std::round(val / DEFAULT_TOLERANCE) * DEFAULT_TOLERANCE;
            uint64_t raw;
            std::memcpy(&raw, &normalized, sizeof(uint64_t));
            
            hash ^= raw;
            hash *= 0x100000001b3ULL;
        }
        
        std::stringstream ss;
        ss << std::hex << hash;
        return ss.str();
    }

    void TopologicalCache::Put(const std::string& dna, double result) {
        std::lock_guard<std::mutex> lock(cacheMutex);
        cache[dna] = result;
    }

    bool TopologicalCache::Get(const std::string& dna, double& outResult) {
        std::lock_guard<std::mutex> lock(cacheMutex);
        auto it = cache.find(dna);
        if (it != cache.end()) {
            outResult = it->second;
            return true;
        }
        return false;
    }

    // --- Z3Gatekeeper Implementation ---

    Z3Gatekeeper::Z3Gatekeeper() : solver(ctx) {
        z3::params p(ctx);
        p.set("timeout", (unsigned)Z3_TIMEOUT_MS);
        solver.set(p);
    }

    bool Z3Gatekeeper::Verify(const std::string& dna, const std::vector<double>& input_state) {
        // 1. Check if we already flattened this manifold
        {
            std::lock_guard<std::mutex> lock(vMutex);
            auto it = verified_manifolds.find(dna);
            if (it != verified_manifolds.end()) {
                return it->second; // INSTANT RETURN - Logic is flattened!
            }
        }

        // 2. Slow path: Call Z3 (only once per DNA bucket)
        solver.push();
        try {
            z3::expr x = ctx.real_const("x");
            solver.add(x > 0); // Placeholder invariant
            
            if (!input_state.empty()) {
                solver.add(x == ctx.real_val(std::to_string(input_state[0]).c_str()));
            }

            bool is_sat = (solver.check() == z3::sat);
            solver.pop();

            // 3. Store the result in our flattened map
            std::lock_guard<std::mutex> lock(vMutex);
            verified_manifolds[dna] = is_sat;
            return is_sat;
        } catch (...) {
            solver.pop();
            return false;
        }
    }

    // --- LogicEngine Implementation ---

    LogicEngine::LogicEngine() {}

    double LogicEngine::Process(const std::vector<double>& input_state, double (*compute_func)(const std::vector<double>&)) {
        std::string dna = cache.GenerateDNA(input_state);
        
        double cached_result;
        if (cache.Get(dna, cached_result)) {
            // Pass DNA to gatekeeper to check the flattened map
            if (gatekeeper.Verify(dna, input_state)) {
                return cached_result;
            }
        }

        double fresh_result = compute_func(input_state);
        cache.Put(dna, fresh_result);
        return fresh_result;
    }

} // namespace MetaSpace
