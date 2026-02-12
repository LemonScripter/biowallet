#include "metaspace_core.hpp"
#include <iostream>
#include <vector>
#include <cmath>

double heavy_compute(const std::vector<double>& input) {
    // Simulate some work
    double x = input[0];
    return std::sin(x) * std::cos(x) + std::sqrt(std::abs(x));
}

int main() {
    MetaSpace::LogicEngine engine;

    std::vector<double> input1 = {10.0};
    std::vector<double> input2 = {10.00001}; // Within 1e-4 tolerance
    std::vector<double> input3 = {11.0};      // Outside

    std::cout << "--- C++ MetaCore Test ---" << std::endl;

    std::cout << "Run 1 (10.0): " << engine.Process(input1, heavy_compute) << " (Should COMPUTE)" << std::endl;
    std::cout << "Run 2 (10.00001): " << engine.Process(input2, heavy_compute) << " (Should SKIP)" << std::endl;
    std::cout << "Run 3 (11.0): " << engine.Process(input3, heavy_compute) << " (Should COMPUTE)" << std::endl;

    return 0;
}
