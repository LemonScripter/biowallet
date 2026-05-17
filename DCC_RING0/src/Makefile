# DCC Ring 0 — eBPF Build System
# Requires: clang, llvm, libbpf-dev, bpftool
# vmlinux.h generated via: bpftool btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h

CLANG    ?= clang
BPFTOOL  ?= bpftool
ARCH     := $(shell uname -m | sed 's/x86_64/x86/' | sed 's/aarch64/arm64/')

CFLAGS_BPF := -g -O2 -target bpf -D__TARGET_ARCH_$(ARCH) \
              -I. -I/usr/include/$(shell uname -m)-linux-gnu

.PHONY: all clean vmlinux

all: vmlinux.h dcc_causality.bpf.o dcc_axiom.bpf.o

vmlinux.h:
	$(BPFTOOL) btf dump file /sys/kernel/btf/vmlinux format c > vmlinux.h
	@echo "[OK] vmlinux.h generated ($(shell wc -l < vmlinux.h) lines)"

%.bpf.o: %.bpf.c vmlinux.h
	$(CLANG) $(CFLAGS_BPF) -c $< -o $@
	@echo "[OK] $@ compiled"
	$(BPFTOOL) prog load $@ /sys/fs/bpf/$(basename $@) 2>/dev/null || true

clean:
	rm -f *.bpf.o vmlinux.h
	rm -f /sys/fs/bpf/dcc_* 2>/dev/null || true

# Gyors ellenőrzés: milyen BPF programok futnak
status:
	@echo "=== Loaded BPF programs ==="
	$(BPFTOOL) prog list 2>/dev/null | grep -E 'dcc|lsm|tracepoint' || echo "(none)"
	@echo "=== Token map entries ==="
	$(BPFTOOL) map dump name token_map 2>/dev/null | head -20 || echo "(empty)"

# LOG-ONLY → BLOCKING mód váltás (csak T6 teszt után!)
enable_blocking:
	@echo "FIGYELEM: Blokkoló mód bekapcsolása!"
	@echo "Biztos vagy benne? A bot whitelistelve van? (Ctrl+C = megszakítás)"
	@sleep 5
	$(BPFTOOL) map update name config_map key 0x00000000 value 0x00000000
	@echo "[OK] Blokkoló mód aktív"

enable_logonly:
	$(BPFTOOL) map update name config_map key 0x00000000 value 0x01000000
	@echo "[OK] Log-only mód visszaállítva"
