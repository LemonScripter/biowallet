#include <iostream>
#include <vector>
#include <chrono>
#include <cmath>
#include <iomanip>
#include "metaspace_core.hpp"

// EXTREME HEAVY TASK: Simulates complex logic or rendering
// Native CPU must work hard, while MetaSpace will identify the redundant manifold.
double HeavySignalTask(const std::vector<double>& input) {
    double x = input[0];
    double res = 0;
    // Increased iterations to make native compute take significant time
    for(int i = 0; i < 5000; ++i) {
        res += std::sin(x + i) * std::cos(x - i) + std::sqrt(std::abs(x + i));
    }
    return res;
}

int main() {
    const int DATA_SIZE = 10000; // 10k points, but each is 5000 iterations
    std::cout << "--- MetaSpace V5.2 HEAVY LOAD DEMO ---" << std::endl;
    std::cout << "Processing " << DATA_SIZE << " points (5000 ops/point)..." << std::endl;

    std::vector<double> signal;
    for(int i = 0; i < DATA_SIZE; ++i) {
        // High redundancy: many points are identical
        double base = (double)(i / 100); 
        signal.push_back(base);
    }

    // --- NATIVE ---
    std::cout << "Running Native (Standard Compute)..." << std::endl;
    auto s1 = std::chrono::high_resolution_clock::now();
    double sum1 = 0;
    for(int i = 0; i < DATA_SIZE; ++i) {
        std::vector<double> inp = {signal[i]};
        sum1 += HeavySignalTask(inp);
    }
    auto e1 = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> t1 = e1 - s1;
    std::cout << "Native Total Time: " << t1.count() << " s" << std::endl;

    // --- METASPACE ---
    std::cout << "Running MetaSpace (Logic Flattening)..." << std::endl;
    MetaSpace::LogicEngine engine;
    auto s2 = std::chrono::high_resolution_clock::now();
    double sum2 = 0;
    for(int i = 0; i < DATA_SIZE; ++i) {
        std::vector<double> inp = {signal[i]};
        sum2 += engine.Process(inp, HeavySignalTask);
    }
    auto e2 = std::chrono::high_resolution_clock::now();
    std::chrono::duration<double> t2 = e2 - s2;
    std::cout << "MetaSpace Total Time: " << t2.count() << " s" << std::endl;

    std::cout << "\n==========================================" << std::endl;
    std::cout << "   FINAL SPEEDUP: " << std::fixed << std::setprecision(2) << t1.count() / t2.count() << "x" << std::endl;
    std::cout << "==========================================" << std::endl;

    return 0;
}
