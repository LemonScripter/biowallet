import json
import os
import sys

CONFIG_FILE = "accelerated_apps.json"

def load_config():
    if not os.path.exists(CONFIG_FILE):
        return {"apps": []}
    with open(CONFIG_FILE, 'r') as f:
        return json.load(f)

def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

def add_app(name, mode="MAX_ACCELERATION"):
    config = load_config()
    # Check if already exists
    if any(app['name'].lower() == name.lower() for app in config['apps']):
        print(f"[MetaSpace] {name} is already in the acceleration list.")
        return
    
    config['apps'].append({"name": name, "mode": mode})
    save_config(config)
    print(f"[MetaSpace] SUCCESS: {name} added to acceleration list.")

def list_apps():
    config = load_config()
    print("--- MetaSpace Accelerated Apps ---")
    for app in config['apps']:
        print(f"- {app['name']} [{app['mode']}]")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python metaspace_control.py <add|list> [app_name]")
        sys.exit(1)

    cmd = sys.argv[1].lower()
    if cmd == "add" and len(sys.argv) > 2:
        add_app(sys.argv[2])
    elif cmd == "list":
        list_apps()
    else:
        print("Unknown command or missing arguments.")
