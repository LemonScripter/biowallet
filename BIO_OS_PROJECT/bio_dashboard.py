import tkinter as tk
from tkinter import ttk, messagebox
import random
import math
import time
import psutil
import json
import os

class BioOSDashboard:
    def __init__(self, root):
        self.root = root
        self.root.title("BioOS - Organic Persistent Organism v0.8")
        self.root.geometry("900x950")
        self.root.configure(bg='#05070a')
        
        # Set Window Icon
        try:
            icon = tk.PhotoImage(file='logo.png')
            self.root.iconphoto(False, icon)
        except:
            pass # Logo not found, continue without icon

        self.start_time = time.time()
        self.memory_file = "bio_memory.json" # Perzisztens tároló
        self.color_vitality = "#00f5d4" 
        self.color_neural = "#00bbf9"   
        self.color_entropy = "#f15bb5"  
        self.color_text = "#e0e1dd"
        
        self.organs = {
            "firefox.exe": {"color": "#ff9500", "label": "FIREFOX", "pos": (600, 100), "active": False},
            "cmd.exe": {"color": "#4dff4d", "label": "CMD", "pos": (600, 220), "active": False},
            "notepad.exe": {"color": "#ffffff", "label": "NOTEPAD", "pos": (600, 340), "active": False}
        }

        # Long-Term Memory Loading
        self.stats = self.load_memory()
        
        self.create_widgets()
        self.animate()

    def load_memory(self):
        if os.path.exists(self.memory_file):
            with open(self.memory_file, 'r') as f:
                return json.load(f)
        return {"vitality": 98.5, "reflexes": 2400, "entropy": 1.2, "generation": 1}

    def save_memory(self):
        with open(self.memory_file, 'w') as f:
            json.dump(self.stats, f)

    def create_widgets(self):
        header_frame = tk.Frame(self.root, bg='#05070a')
        header_frame.pack(fill='x', padx=30, pady=10)
        tk.Label(header_frame, text="BioOS Organism v0.8", font=('Segoe UI Light', 24), bg='#05070a', fg=self.color_text).pack(side='left')
        tk.Button(header_frame, text=" i ", font=('Segoe UI Bold', 12), bg='#1b263b', fg=self.color_neural, 
                  relief='flat', command=self.show_info, padx=10).pack(side='right')

        self.canvas = tk.Canvas(self.root, width=800, height=420, bg='#080a0f', highlightthickness=1, highlightbackground='#1b263b')
        self.canvas.pack(pady=10)
        
        self.nucleus_outer = self.canvas.create_oval(100, 120, 260, 280, outline='#1b263b', width=1)
        self.nucleus = self.canvas.create_oval(120, 140, 240, 260, fill='#1b263b', outline=self.color_neural, width=2)
        self.canvas.create_text(180, 310, text="BIO-CORE", fill=self.color_neural, font=('Segoe UI Bold', 14))

        for exe, data in self.organs.items():
            x, y = data["pos"]
            data["glow_id"] = self.canvas.create_oval(x-40, y-40, x+40, y+40, outline='#111', width=1)
            data["cell_id"] = self.canvas.create_oval(x-30, y-30, x+30, y+30, fill='#05070a', outline='#333', width=1)
            data["synapse_id"] = self.canvas.create_line(260, 200, x-40, y, fill='#1b263b', width=1, dash=(2, 4))
            data["text_id"] = self.canvas.create_text(x + 60, y, text=f"{data['label']}\nOFFLINE", fill='#444', font=('Segoe UI', 10), anchor='w')

        stats_frame = tk.Frame(self.root, bg='#05070a')
        stats_frame.pack(pady=10, fill='x', padx=100)
        self.add_stat_bar(stats_frame, "SYSTEM VITALITY", self.color_vitality, 'vit_bar')
        self.add_stat_bar(stats_frame, "NEURAL DENSITY", self.color_neural, 'neu_bar')
        self.add_stat_bar(stats_frame, "HOMEOSTATIC BALANCE", self.color_entropy, 'ent_bar')

        btn_panel = tk.Frame(self.root, bg='#05070a')
        btn_panel.pack(pady=30)

        tk.Button(btn_panel, text="STIMULATE CELL", command=self.feed, 
                  bg='#1b263b', fg=self.color_vitality, font=('Segoe UI', 12, 'bold'), 
                  relief='flat', padx=40, pady=15).pack(side='left', padx=20)
        
        tk.Button(btn_panel, text="EVOLVE DNA", command=self.sync, 
                  bg='#1b263b', fg=self.color_neural, font=('Segoe UI', 12, 'bold'), 
                  relief='flat', padx=40, pady=15).pack(side='left', padx=20)

    def add_stat_bar(self, parent, label, color, attr_name):
        tk.Label(parent, text=label, font=('Segoe UI', 9, 'bold'), bg='#05070a', fg=color).pack(anchor='w', pady=(5, 0))
        bar = ttk.Progressbar(parent, length=600, mode='determinate')
        bar.pack(pady=2)
        setattr(self, attr_name, bar)

    def animate(self):
        t = time.time()
        pulse = math.sin(t * 1.8) * 12
        self.canvas.coords(self.nucleus, 120-pulse, 140-pulse, 240+pulse, 260+pulse)
        
        running_procs = [p.info['name'].lower() for p in psutil.process_iter(['name'])]
        
        for exe, data in self.organs.items():
            is_active = exe.lower() in running_procs
            x, y = data["pos"]
            if is_active:
                p2 = math.sin(t * 2.5 + x) * 8
                self.canvas.itemconfig(data["cell_id"], outline=data["color"], width=2, fill='#0b111a')
                self.canvas.itemconfig(data["synapse_id"], fill=self.color_vitality, width=2, dash=())
                self.canvas.itemconfig(data["text_id"], text=f"{data['label']}\nACCELERATED", fill=data["color"])
                self.canvas.coords(data["cell_id"], x-30-p2, y-30-p2, x+30+p2, y+30+p2)
            else:
                self.canvas.itemconfig(data["cell_id"], outline='#333', width=1, fill='#05070a')
                self.canvas.itemconfig(data["synapse_id"], fill='#1b263b', width=1, dash=(2, 4))
                self.canvas.itemconfig(data["text_id"], text=f"{data['label']}\nOFFLINE", fill='#444')
                self.canvas.coords(data["cell_id"], x-30, y-30, x+30, y+30)

        self.vit_bar['value'] = self.stats['vitality']
        self.neu_bar['value'] = min(100, (self.stats['reflexes'] / 50))
        self.ent_bar['value'] = 100 - (self.stats['entropy'] * 10 + random.uniform(0, 5))
        
        self.save_memory() # Folyamatos mentés
        self.root.after(50, self.animate)

    def show_info(self):
        uptime = int(time.time() - self.start_time)
        messagebox.showinfo("BioOS Audit", f"Bio-Core: v0.8\nGeneration: {self.stats['generation']}\nStored Reflexes: {self.stats['reflexes']}\nMemory: PERSISTENT")

    def feed(self):
        self.stats['reflexes'] += 200
        self.save_memory()

    def sync(self):
        messagebox.showinfo("DNA Sync", "Knowledge preserved in Long-term Memory.")

if __name__ == "__main__":
    root = tk.Tk()
    app = BioOSDashboard(root)
    root.mainloop()
