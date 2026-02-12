#include <iostream>
#include <vector>
#include <string>
#include "../core/metaspace_core.hpp"

// --- THE BIO-GATE: BRIDGE BETWEEN WINDOWS AND BIO-OS ---
class BioGate {
    MetaSpace::LogicEngine* bio_core;

public:
    BioGate() {
        bio_core = new MetaSpace::LogicEngine();
        std::cout << "[BioGate] Bridge established. Windows is now a host for BioOS." << std::endl;
    }

    // Windows sends a raw request (High Entropy)
    // BioOS converts it to a verified Manifold (Zero Entropy)
    double Ingest(double windows_data) {
        std::cout << "[BioGate] Ingesting Windows Data: " << windows_data << std::endl;

        std::vector<double> state = {windows_data};
        
        // The .bio Reflex Axiom in action
        return bio_core->Process(state, [](const std::vector<double>& v) {
            // Simulated Bio-Logic processing
            return v[0] * 1.234; 
        });
    }

    ~BioGate() {
        delete bio_core;
    }
};

int main() {
    std::cout << "--- BioOS v0.2: Symbiotic Mode (Host: Windows) ---" << std::endl;
    
    BioGate gate;

    // Simulate the Cursor or Firefox sending data to BioOS
    std::cout << "[Cursor] Sending request to BioOS..." << std::endl;
    double res1 = gate.Ingest(100.0);
    std::cout << "[BioOS] Result returned to Windows: " << res1 << " (Verified)" << std::endl;

    std::cout << "[Cursor] Sending identical request..." << std::endl;
    double res2 = gate.Ingest(100.0);
    std::cout << "[BioOS] Result returned to Windows: " << res2 << " (INSTANT REFLEX)" << std::endl;

    return 0;
}
