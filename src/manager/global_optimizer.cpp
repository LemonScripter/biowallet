#include <windows.h>
#include <tlhelp32.h>
#include <iostream>
#include <vector>
#include <string>
#include <thread>
#include <chrono>
#include "metaspace_core.hpp"

// Global Engine for decision making
MetaSpace::LogicEngine* g_SupervisorEngine = nullptr;

void OptimizeProcess(DWORD pid, const std::string& name) {
    HANDLE hProcess = OpenProcess(PROCESS_ALL_ACCESS, FALSE, pid);
    if (hProcess) {
        // 1. Set to REALTIME priority (Highest possible in Windows)
        if (SetPriorityClass(hProcess, REALTIME_PRIORITY_CLASS)) {
            // std::cout << "[MetaSupervisor] " << name << " -> REALTIME PRIORITY" << std::endl;
        }

        // 2. Lock to Performance Cores (Affinity Mask)
        // Assume first 4 cores are the fastest for this prototype
        DWORD_PTR affinityMask = 0x000F; 
        if (SetProcessAffinityMask(hProcess, affinityMask)) {
            // std::cout << "[MetaSupervisor] " << name << " -> LOCKED TO PERFORMANCE CORES" << std::endl;
        }

        CloseHandle(hProcess);
    }
}

void RestoreProcess(DWORD pid) {
    HANDLE hProcess = OpenProcess(PROCESS_SET_INFORMATION, FALSE, pid);
    if (hProcess) {
        SetPriorityClass(hProcess, NORMAL_PRIORITY_CLASS);
        CloseHandle(hProcess);
    }
}

int main() {
    std::cout << "===================================================" << std::endl;
    std::cout << "   MetaSpace Supervisor v5.0 (Flattened Logic)     " << std::endl;
    std::cout << "===================================================" << std::endl;

    try {
        g_SupervisorEngine = new MetaSpace::LogicEngine();
        std::cout << "[Init] Decision Engine Online." << std::endl;
    } catch (...) {
        return 1;
    }

    // In a real scenario, we'd use a JSON library like nlohmann/json
    // For this high-performance prototype, we simulate the registry/config scan
    std::vector<std::string> target_apps = {"firefox.exe", "python.exe", "maya.exe", "blender.exe"};

    while (true) {
        HANDLE hSnapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if (hSnapshot != INVALID_HANDLE_VALUE) {
            PROCESSENTRY32 pe32;
            pe32.dwSize = sizeof(PROCESSENTRY32);
            if (Process32First(hSnapshot, &pe32)) {
                do {
                    std::string procName = pe32.szExeFile;
                    bool is_target = false;
                    for(const auto& app : target_apps) {
                        if (procName == app) { is_target = true; break; }
                    }

                    if (is_target) {
                        // MetaSpace Logic Decision: PID + Time based Manifold
                        std::vector<double> state = {(double)pe32.th32ProcessID, (double)time(NULL)};
                        
                        double decision = g_SupervisorEngine->Process(state, [](const std::vector<double>& v) {
                            return 1.0; 
                        });

                        if (decision > 0.5) {
                            OptimizeProcess(pe32.th32ProcessID, procName);
                        }
                    }
                } while (Process32Next(hSnapshot, &pe32));
            }
            CloseHandle(hSnapshot);
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(1000));
    }

    return 0;
}
