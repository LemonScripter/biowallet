import os
import sys
import subprocess
import ctypes

def launch(target_cmd):
    dll_path = os.path.abspath("metaspace_accelerator.dll")
    
    if not os.path.exists(dll_path):
        print(f"ERROR: {dll_path} not found!")
        return

    print(f"--- MetaSpace Launcher v4.1 ---")
    print(f"Target: {target_cmd}")
    print(f"Accelerator: {dll_path}")
    
    # We set the PATH so the program finds libz3.dll automatically
    env = os.environ.copy()
    current_dir = os.getcwd()
    env["PATH"] = current_dir + os.pathsep + env.get("PATH", "")
    
    print("Launching with MetaSpace acceleration...")
    
    try:
        # We start the process normally
        # In a more advanced version, we would use Detours or a Loader
        # For now, we use a simple environment-based approach
        process = subprocess.Popen(target_cmd, env=env)
        print(f"Process started (PID: {process.pid})")
        process.wait()
    except Exception as e:
        print(f"Failed to launch: {e}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python metaspace_launcher.py <command>")
    else:
        launch(sys.argv[1:])
