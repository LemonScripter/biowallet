#include <iostream>
#include <vector>
#include <string>
#include <chrono>
#include <thread>
#include <cstdlib>

// --- THE GENETIC CODE ---
struct BioDNA {
    uint64_t generation;
    double knowledge_density; // How optimized the logic is
    std::vector<uint64_t> inherited_reflexes; // Skills passed down
};

// --- THE ORGANISM (BioOS Instance) ---
class BioOrganism {
public:
    BioDNA dna;
    double age;
    double biomass; // System resources used/grown
    double entropy; // System junk/instability
    bool is_alive;

    BioOrganism(BioDNA seed) {
        dna = seed;
        age = 0.0;
        biomass = 10.0; // Starting small (microkernel)
        entropy = 0.0;
        is_alive = true;
        
        std::cout << "\n[GENESIS] A new BioOS is born. Generation: " << dna.generation << std::endl;
        std::cout << "[INHERITANCE] Inherited Reflexes: " << dna.inherited_reflexes.size() << std::endl;
    }

    void LiveOneCycle(int workload) {
        if (!is_alive) return;

        // 1. GROWTH: The system adapts to usage
        age += 0.1;
        biomass += (workload * 0.05); // Grows logic structures based on work
        
        // 2. LEARNING (MetaSpace Optimization)
        // The more it lives, the denser its knowledge becomes
        dna.knowledge_density += 0.01;

        // 3. ENTROPY (Aging)
        // Every operation creates a tiny bit of waste/fragmentation
        entropy += (workload * 0.01) - (dna.knowledge_density * 0.005);
        
        // Ensure entropy doesn't go negative
        if (entropy < 0) entropy = 0;

        // Visualizing Life
        std::cout << "   [Cycle " << (int)age << "] Biomass: " << (int)biomass 
                  << " | Entropy: " << (int)entropy 
                  << " | Speed: " << (1.0 + dna.knowledge_density) << "x" << std::endl;

        // 4. DEATH CONDITION
        if (entropy > 100.0) {
            Die();
        }
    }

    void Die() {
        std::cout << "\n[APOPTOSIS] Entropy Critical! System is shutting down for rebirth." << std::endl;
        is_alive = false;
    }

    // Creates the seed for the NEXT generation
    BioDNA Reproduce() {
        std::cout << "[REBIRTH] Compressing verified logic into new Stem Cell..." << std::endl;
        
        BioDNA child_dna;
        child_dna.generation = dna.generation + 1;
        child_dna.knowledge_density = dna.knowledge_density; // Pass on the optimization!
        
        // Pass on the best reflexes (Simulated)
        child_dna.inherited_reflexes = dna.inherited_reflexes;
        child_dna.inherited_reflexes.push_back(0xCAFEBABE + dna.generation);

        return child_dna;
    }
};

int main() {
    std::cout << "=== BioOS Evolutionary Simulation ===" << std::endl;

    // Start with a blank slate
    BioDNA seed_dna = {1, 0.0, {}};
    
    // Simulate generations
    while (seed_dna.generation <= 3) {
        BioOrganism os(seed_dna);

        // Run the OS until it dies from entropy
        while (os.is_alive) {
            // Simulate random workload (User opening apps, rendering)
            int work = rand() % 20 + 5; 
            os.LiveOneCycle(work);
            
            std::this_thread::sleep_for(std::chrono::milliseconds(200));
        }

        // The OS has died. Create the next generation from its ashes.
        seed_dna = os.Reproduce();
        
        std::cout << "----------------------------------------" << std::endl;
        std::this_thread::sleep_for(std::chrono::seconds(1));
    }

    std::cout << "Simulation Complete. Observe how Speed increases with each Generation." << std::endl;
    return 0;
}
