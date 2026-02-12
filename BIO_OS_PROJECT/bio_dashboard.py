import tkinter as tk
from tkinter import ttk, messagebox
import random
import math
import time
from datetime import datetime

class BioOSDashboard:
    def __init__(self, root):
        self.root = root
        self.root.title("BioOS - Organism Dashboard")
        self.root.geometry("800x650")
        self.root.configure(bg='#080a0f')

        self.start_time = time.time()
        self.color_vitality = "#00f5d4" 
        self.color_neural = "#00bbf9"   
        self.color_entropy = "#f15bb5"  
        self.color_text = "#e0e1dd"

        self.stats = {
            "vitality": 98.5,
            "reflexes": 1420,
            "generation": 2,
            "entropy": 1.4
        }

        self.create_widgets()
        self.animate()

    def create_widgets(self):
        # Top Bar with Info Button
        top_frame = tk.Frame(self.root, bg='#080a0f')
        top_frame.pack(fill='x', padx=20, pady=10)
        
        tk.Label(top_frame, text="BioOS Organism v0.2", font=('Segoe UI Light', 18), bg='#080a0f', fg=self.color_text).pack(side='left')
        
        info_btn = tk.Button(top_frame, text=" i ", font=('Segoe UI Bold', 12), bg='#1b263b', fg=self.color_neural, 
                            relief='flat', command=self.show_info, padx=10)
        info_btn.pack(side='right')

        # Main Cell Area (Rectangle)
        self.canvas = tk.Canvas(self.root, width=700, height=250, bg='#0b111a', highlightthickness=1, highlightbackground='#1b263b')
        self.canvas.pack(pady=20)
        
        # Central Organism (Pulse)
        self.nucleus = self.canvas.create_oval(300, 75, 400, 175, fill='#1b263b', outline=self.color_neural, width=2)
        self.membrane = self.canvas.create_oval(280, 55, 420, 195, outline=self.color_vitality, width=1, dash=(5, 5))

        # Progress Bars
        stats_frame = tk.Frame(self.root, bg='#080a0f')
        stats_frame.pack(pady=10, fill='x', padx=100)

        self.add_stat_bar(stats_frame, "SYSTEM VITALITY", self.color_vitality, 'vit_bar')
        self.add_stat_bar(stats_frame, "NEURAL DENSITY", self.color_neural, 'neu_bar')
        self.add_stat_bar(stats_frame, "ENTROPY LEVEL", self.color_entropy, 'ent_bar')

        # BOTTOM BUTTONS (ENSURING THEY ARE VISIBLE)
        btn_frame = tk.Frame(self.root, bg='#080a0f')
        btn_frame.pack(pady=40)

        self.feed_btn = tk.Button(btn_frame, text="FEED DATA", command=self.feed, 
                                 bg='#1b263b', fg=self.color_vitality, font=('Segoe UI', 10, 'bold'), 
                                 relief='flat', padx=30, pady=10)
        self.feed_btn.pack(side='left', padx=20)
        
        self.sync_btn = tk.Button(btn_frame, text="SYNC DNA", command=self.sync, 
                                 bg='#1b263b', fg=self.color_neural, font=('Segoe UI', 10, 'bold'), 
                                 relief='flat', padx=30, pady=10)
        self.sync_btn.pack(side='left', padx=20)

    def add_stat_bar(self, parent, label, color, attr_name):
        tk.Label(parent, text=label, font=('Segoe UI', 9, 'bold'), bg='#080a0f', fg=color).pack(anchor='w', pady=(5, 0))
        bar = ttk.Progressbar(parent, length=600, mode='determinate')
        bar.pack(pady=2)
        setattr(self, attr_name, bar)

    def show_info(self):
        uptime = int(time.time() - self.start_time)
        info_text = (
            f"BioOS Biological Audit:\n\n"
            f"AGE: {uptime} seconds in current life cycle\n"
            f"GENERATION: {self.stats['generation']}\n"
            f"REFLEXES: {self.stats['reflexes']} Manifolds Flattened\n"
            f"Z3 STATUS: Equilibrium Reached (431ns response time)\n\n"
            "Status: Healthy & Evolutionary Active."
        )
        messagebox.showinfo("BioOS Organism Info", info_text)

    def animate(self):
        t = time.time()
        pulse = math.sin(t * 1.5) * 8
        self.canvas.coords(self.nucleus, 300-pulse, 75-pulse, 400+pulse, 175+pulse)
        self.canvas.coords(self.membrane, 280-pulse*0.6, 55-pulse*0.6, 420+pulse*0.6, 195+pulse*0.6)

        # Update bars
        self.vit_bar['value'] = self.stats['vitality']
        self.neu_bar['value'] = min(100, (self.stats['reflexes'] / 20))
        self.ent_bar['value'] = self.stats['entropy'] + random.uniform(0, 2)

        self.root.after(50, self.animate)

    def feed(self):
        self.stats['reflexes'] += 50
        messagebox.showinfo("Feed", "New data patterns ingested. Knowledge expanded!")

    def sync(self):
        try:
            with open("BIO_OS_PROJECT/os_src/genesis.bio", "r") as f:
                dna_content = f.read()
            
            dna_win = tk.Toplevel(self.root)
            dna_win.title("GENESIS DNA (Axioms)")
            dna_win.geometry("500x400")
            dna_win.configure(bg='#080a0f')
            
            txt = tk.Text(dna_win, bg='#0b111a', fg=self.color_neural, font=('Consolas', 10))
            txt.insert('1.0', dna_content)
            txt.pack(expand=True, fill='both', padx=20, pady=20)
        except:
            messagebox.showerror("Error", "Could not find genesis.bio")

if __name__ == "__main__":
    root = tk.Tk()
    app = BioOSDashboard(root)
    root.mainloop()
