#include <windows.h>
#include <iostream>
#include <cmath>
#include <cstdio>
#include "metaspace_core.hpp"

// Global Engine instance for the host process
MetaSpace::LogicEngine* g_Engine = nullptr;

// Helper function for the engine callback
double HeavyMath(const std::vector<double>& v) {
    if (v.empty()) return 0.0;
    return std::sin(v[0]);
}

void InitializeAcceleration() {
    try {
        g_Engine = new MetaSpace::LogicEngine();
        
        char hostName[MAX_PATH];
        if (GetModuleFileNameA(NULL, hostName, MAX_PATH)) {
            char msg[512];
            std::sprintf(msg, "[MetaSpace] ACCELERATOR ATTACHED TO: %s\n", hostName);
            OutputDebugStringA(msg);
        }
    } catch (...) {
        OutputDebugStringA("[MetaSpace] CRITICAL ERROR: Failed to initialize Logic Engine.\n");
    }
}

BOOL APIENTRY DllMain(HMODULE hModule, DWORD  ul_reason_for_call, LPVOID lpReserved) {
    switch (ul_reason_for_call) {
    case DLL_PROCESS_ATTACH:
        {
            DisableThreadLibraryCalls(hModule);
            // Create initialization thread safely
            HANDLE hThread = CreateThread(NULL, 0, (LPTHREAD_START_ROUTINE)InitializeAcceleration, NULL, 0, NULL);
            if (hThread) CloseHandle(hThread);
        }
        break;
    case DLL_PROCESS_DETACH:
        if (g_Engine) {
            // Use a temporary pointer to avoid race conditions during shutdown
            MetaSpace::LogicEngine* temp = g_Engine;
            g_Engine = nullptr;
            delete temp;
        }
        break;
    }
    return TRUE;
}

extern "C" __declspec(dllexport) double MetaSpace_Process(double input) {
    if (!g_Engine) return 0.0;
    
    std::vector<double> inputs = {input};
    return g_Engine->Process(inputs, HeavyMath);
}
