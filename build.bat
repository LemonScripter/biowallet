@echo off
set COMPILER_PATH=C:\Users\lszok\Downloads\w64devkit\bin
set PATH=%COMPILER_PATH%;%PATH%

set Z3_INCLUDE=C:\Users\lszok\AppData\Roaming\Python\Python312\site-packages\z3\include
set Z3_LIB_DIR=C:\Users\lszok\AppData\Roaming\Python\Python312\site-packages\z3\lib

echo --- MetaSpace V4.0 Build System (DLL Edition) ---

if not exist build mkdir build

echo [1/4] Compiling MetaSpace Core (Static Library for testing)...
g++ -O3 -mavx2 src/core/metaspace_core.cpp src/core/main_test.cpp -o build/metaspace_test.exe -Isrc/core -I"%Z3_INCLUDE%" -L"%Z3_LIB_DIR%" -lz3
if %errorlevel% neq 0 (
    echo HIBA a Core forditasakor!
) else (
    copy "%Z3_LIB_DIR%\libz3.dll" build\ >nul
)

echo [2/4] Compiling MetaSpace Global Accelerator (The DLL Payload)...
g++ -shared -O3 -mavx2 src/core/metaspace_core.cpp src/core/metaspace_dll_main.cpp -o build/metaspace_accelerator.dll -Isrc/core -I"%Z3_INCLUDE%" -L"%Z3_LIB_DIR%" -lz3 -Wl,--out-implib,build/libmetaspace_accelerator.a
if %errorlevel% neq 0 (
    echo HIBA a DLL forditasakor!
) else (
    echo DLL Sikeresen legyartva!
)

echo [3/4] Compiling Global Optimizer (The Watchdog)...
g++ -O3 src/manager/global_optimizer.cpp -o build/metaspace_manager.exe -lpsapi
if %errorlevel% neq 0 (
    echo HIBA a Manager forditasakor!
)

echo [4/4] Compiling MetaCore System Service (Ghost Driver)...
g++ -O3 src/service/metacore_service.cpp src/core/metaspace_core.cpp -o build/metacore_service.exe -Isrc/core -I"%Z3_INCLUDE%" -L"%Z3_LIB_DIR%" -lz3 -lws2_32
if %errorlevel% neq 0 (
    echo HIBA a Service forditasakor!
) else (
    echo Service SIKERES!
)

echo --- Build Finished! ---
dir build
