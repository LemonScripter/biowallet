@echo off
echo ===================================================
echo      BioOS v0.2 - SYMBIOTIC BOOT SEQUENCE
echo ===================================================
echo [1/3] Initializing Bio-Neural Network (Supervisor)...
start /b build\metaspace_supervisor.exe

echo [2/3] Opening Bio-Gate (Logic Bridge)...
copy build\libz3.dll . >nul
$env:PATH = "C:\Users\lszok\Downloads\w64devkit\bin;" + $env:PATH
g++ BIO_OS_PROJECT/os_src/bio_gate.cpp BIO_OS_PROJECT/core/metaspace_core.cpp -o BIO_OS_PROJECT/bio_gate.exe -IBIO_OS_PROJECT/core -I"C:\Users\lszok\AppData\Roaming\Python\Python312\site-packages\z3\include" -L"C:\Users\lszok\AppData\Roaming\Python\Python312\site-packages\z3\lib" -lz3
start /b BIO_OS_PROJECT\bio_gate.exe

echo [3/3] Establishing Homeostasis...
echo BioOS IS NOW ACTIVE ON YOUR SYSTEM.
echo The Bio-Zone is maintaining equilibrium.
echo ===================================================
pause
