// DCC Ring 0 — Fázis 8+9: Intent Binding + Atomi Tranzakció Loader
//
// Fordítás:
//   gcc -g -O2 -o dcc_loader dcc_loader.c -lbpf -lelf -lz
//
// Futtatás:
//   sudo ./dcc_loader dcc_core.bpf.o [opciók]
//
// Opciók (Phase 7 örökség):
//   --blocking           Írás blokkolás
//   --read-guard[-block] Olvasás audit/blokkolás
//   --net-guard[-block]  Hálózat audit/blokkolás
//   --exec-guard[-block] Exec audit/blokkolás
//   --whitelist <comm>   Hívó folyamat whitelist
//   --exec-allow <name>  Exec target whitelist
//   --quiet              Csak UNSAT eseményeket mutat
//
// ÚJ opciók (Phase 8+9):
//   --protect <file>:<op>  Fájl axiom: op=write|any|block
//                          Példa: --protect bio_memory.json:write
//                          Példa: --protect shadow.log:block
//   --axiom-test           TOCTOU teszt: két különböző fájlba ír, ellenőrzi a rollbacket

#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>
#include <errno.h>
#include <bpf/libbpf.h>
#include <bpf/bpf.h>

// ─── Verdict kódok ───
#define VERDICT_SAT              1
#define VERDICT_NO_TOKEN         2
#define VERDICT_EXPIRED          3
#define VERDICT_CONSUMED         4
#define VERDICT_AXIOM            5
#define VERDICT_WHITELISTED      6
#define VERDICT_TOKEN_INHERITED  7
#define VERDICT_READ_BLOCKED     8
#define VERDICT_NET_BLOCKED      9
#define VERDICT_EXEC_BLOCKED    10
#define VERDICT_TX_ROLLBACK     11   // Phase 9: TOCTOU
#define VERDICT_AXIOM_MISMATCH  12   // Phase 8: op_class mismatch

// op_class értékek
#define OP_WRITE  (1u << 0)
#define OP_NET    (1u << 1)
#define OP_EXEC   (1u << 2)
#define OP_ANY    0xFFu
#define OP_BLOCK  0x00u

#define GUARD_OFF   0
#define GUARD_LOG   1
#define GUARD_BLOCK 2

// ─── Struktúrák ───
struct audit_event {
    __u64 timestamp_ns;
    __u32 pid;
    __u32 verdict;
    char  comm[16];
    __u8  extra;
    __u8  _pad[3];
};

struct config_t {
    __u32 log_only;
    __u32 read_guard;
    __u32 net_guard;
    __u32 exec_guard;
};

// ─── Globálisok ───
static volatile int running = 1;
static long sat_count      = 0;
static long wl_count       = 0;
static long inherit_count  = 0;
static long write_unsat    = 0;
static long read_unsat     = 0;
static long net_unsat      = 0;
static long exec_unsat     = 0;
static long tx_rollback    = 0;   // Phase 9: TOCTOU rollback
static long axiom_mismatch = 0;   // Phase 8: op_class mismatch

// ─── ANSI ───
#define GREEN   "\033[92m"
#define RED     "\033[91m"
#define YELLOW  "\033[93m"
#define BLUE    "\033[94m"
#define CYAN    "\033[96m"
#define MAGENTA "\033[95m"
#define ORANGE  "\033[38;5;208m"
#define RESET   "\033[0m"

static void handle_sigint(int sig) { running = 0; }

static const char *verdict_name(int v) {
    switch (v) {
        case VERDICT_SAT:             return "SAT        ";
        case VERDICT_NO_TOKEN:        return "NO_TOKEN   ";
        case VERDICT_EXPIRED:         return "EXPIRED    ";
        case VERDICT_CONSUMED:        return "CONSUMED   ";
        case VERDICT_AXIOM:           return "AXIOM      ";
        case VERDICT_WHITELISTED:     return "WHITELIST  ";
        case VERDICT_TOKEN_INHERITED: return "INHERITED  ";
        case VERDICT_READ_BLOCKED:    return "RD_BLOCK   ";
        case VERDICT_NET_BLOCKED:     return "NET_BLOCK  ";
        case VERDICT_EXEC_BLOCKED:    return "EX_BLOCK   ";
        case VERDICT_TX_ROLLBACK:     return "TX_ROLLBACK";  // Phase 9
        case VERDICT_AXIOM_MISMATCH:  return "AX_MISMATCH";  // Phase 8
        default:                      return "UNKNOWN    ";
    }
}

static const char *verdict_color(int v) {
    switch (v) {
        case VERDICT_SAT:             return GREEN;
        case VERDICT_WHITELISTED:     return CYAN;
        case VERDICT_TOKEN_INHERITED: return BLUE;
        case VERDICT_TX_ROLLBACK:     return ORANGE;   // Phase 9: narancssárga
        case VERDICT_AXIOM_MISMATCH:  return YELLOW;   // Phase 8: sárga
        case VERDICT_READ_BLOCKED:
        case VERDICT_NET_BLOCKED:
        case VERDICT_EXEC_BLOCKED:    return MAGENTA;
        default:                      return RED;
    }
}

static const char *extra_tag(int extra) {
    switch (extra) {
        case 1:  return "[READ]";
        case 2:  return "[NET] ";
        case 3:  return "[EXEC]";
        default: return "[WRIT]";
    }
}

static int handle_event(void *ctx, void *data, size_t sz) {
    if (sz < sizeof(struct audit_event)) return 0;
    struct audit_event *ev = data;

    time_t t = time(NULL);
    struct tm *tm_info = localtime(&t);
    char ts[16];
    strftime(ts, sizeof(ts), "%H:%M:%S", tm_info);

    const char *name  = verdict_name(ev->verdict);
    const char *color = verdict_color(ev->verdict);
    char comm[17] = {0};
    memcpy(comm, ev->comm, 16);

    switch (ev->verdict) {
        case VERDICT_SAT:             sat_count++;      break;
        case VERDICT_WHITELISTED:     wl_count++;       break;
        case VERDICT_TOKEN_INHERITED: inherit_count++;  break;
        case VERDICT_READ_BLOCKED:    read_unsat++;     break;
        case VERDICT_NET_BLOCKED:     net_unsat++;      break;
        case VERDICT_EXEC_BLOCKED:    exec_unsat++;     break;
        case VERDICT_TX_ROLLBACK:     tx_rollback++;    break;
        case VERDICT_AXIOM_MISMATCH:  axiom_mismatch++; break;
        default:                      write_unsat++;    break;
    }

    int *quiet = (int *)ctx;
    if (*quiet) {
        if (ev->verdict == VERDICT_SAT || ev->verdict == VERDICT_WHITELISTED)
            return 0;
    }

    printf("[%s] %s%s%s %s  pid=%-7u  comm=%-16s\n",
           ts, color, name, RESET,
           extra_tag(ev->extra), ev->pid, comm);
    fflush(stdout);
    return 0;
}

static void print_summary(void) {
    long total = sat_count + wl_count + inherit_count
               + write_unsat + read_unsat + net_unsat + exec_unsat
               + tx_rollback + axiom_mismatch;
    printf("\n%s\n", "═══════════════════════════════════════════════════════");
    printf(" DCC Audit Összesítő (Fázis 8+9: Challenge Paritás)\n");
    printf("%s\n", "═══════════════════════════════════════════════════════");
    printf("  " GREEN   "SAT              %6ld" RESET "  (hardware-rooted)\n",       sat_count);
    printf("  " CYAN    "WHITELIST        %6ld" RESET "  (megbízható folyamat)\n",   wl_count);
    printf("  " BLUE    "TOKEN_INHERITED  %6ld" RESET "  (fork örökítés)\n",         inherit_count);
    printf("  " RED     "WRITE_UNSAT      %6ld" RESET "  (írás: nincs IRQ)\n",       write_unsat);
    printf("  " MAGENTA "READ_BLOCKED     %6ld" RESET "  (olvasás: nincs IRQ)\n",    read_unsat);
    printf("  " MAGENTA "NET_BLOCKED      %6ld" RESET "  (hálózat: nincs IRQ)\n",    net_unsat);
    printf("  " MAGENTA "EXEC_BLOCKED     %6ld" RESET "  (exec: nincs IRQ)\n",       exec_unsat);
    printf("  " ORANGE  "TX_ROLLBACK      %6ld" RESET "  (TOCTOU: más inode, hard block)\n", tx_rollback);
    printf("  " YELLOW  "AXIOM_MISMATCH   %6ld" RESET "  (op_class ≠ fájl axiom)\n", axiom_mismatch);
    printf("  ÖSSZES           %6ld\n", total);
    if (total > 0) {
        long trusted = sat_count + wl_count + inherit_count;
        long blocked = write_unsat + read_unsat + net_unsat + exec_unsat
                     + tx_rollback + axiom_mismatch;
        printf("  Megbízható: %.1f%%   Blokkolt: %.1f%%\n",
               100.0 * trusted / total, 100.0 * blocked / total);
    }
    if (tx_rollback > 0)
        printf("  " ORANGE "[!] %ld TOCTOU kísérlet sikeresen blokkolva\n" RESET, tx_rollback);
    printf("%s\n", "═══════════════════════════════════════════════════════");
}

static struct bpf_link *attach_prog(struct bpf_object *obj, const char *name) {
    struct bpf_program *prog = bpf_object__find_program_by_name(obj, name);
    if (!prog) { fprintf(stderr, "[--]  %s: nem talalt\n", name); return NULL; }
    struct bpf_link *link = bpf_program__attach(prog);
    if (!link || libbpf_get_error(link)) {
        fprintf(stderr, "[!!]  %s: csatlakozas sikertelen\n", name);
        return NULL;
    }
    printf("[OK]  %s csatlakoztatva\n", name);
    return link;
}

// --protect <filename>:<op> → op_class bitmask
static __u32 parse_op_class(const char *op_str) {
    if (!strcmp(op_str, "write"))  return OP_WRITE;
    if (!strcmp(op_str, "net"))    return OP_NET;
    if (!strcmp(op_str, "exec"))   return OP_EXEC;
    if (!strcmp(op_str, "any"))    return OP_ANY;
    if (!strcmp(op_str, "block"))  return OP_BLOCK;
    fprintf(stderr, "[!!] Ismeretlen op_class: '%s' (write|net|exec|any|block)\n", op_str);
    return OP_ANY;
}

int main(int argc, char **argv) {
    int blocking        = 0;
    int quiet           = 0;
    int read_guard_mode = GUARD_OFF;
    int net_guard_mode  = GUARD_OFF;
    int exec_guard_mode = GUARD_OFF;
    const char *obj_path = "dcc_core.bpf.o";

    const char *whitelist[32];  int wl_argc = 0;
    const char *exec_allow[32]; int ea_argc = 0;

    // Phase 8: --protect <file>:<op>
    const char *protect_file[32];
    __u32       protect_op[32];
    int         protect_argc = 0;

    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--blocking"))          { blocking = 1; continue; }
        if (!strcmp(argv[i], "--quiet"))             { quiet    = 1; continue; }
        if (!strcmp(argv[i], "--read-guard"))        { read_guard_mode = GUARD_LOG;   continue; }
        if (!strcmp(argv[i], "--read-guard-block"))  { read_guard_mode = GUARD_BLOCK; continue; }
        if (!strcmp(argv[i], "--net-guard"))         { net_guard_mode  = GUARD_LOG;   continue; }
        if (!strcmp(argv[i], "--net-guard-block"))   { net_guard_mode  = GUARD_BLOCK; continue; }
        if (!strcmp(argv[i], "--exec-guard"))        { exec_guard_mode = GUARD_LOG;   continue; }
        if (!strcmp(argv[i], "--exec-guard-block"))  { exec_guard_mode = GUARD_BLOCK; continue; }
        if (!strcmp(argv[i], "--whitelist") && i + 1 < argc) {
            if (wl_argc < 32) whitelist[wl_argc++] = argv[++i];
            continue;
        }
        if (!strcmp(argv[i], "--exec-allow") && i + 1 < argc) {
            if (ea_argc < 32) exec_allow[ea_argc++] = argv[++i];
            continue;
        }
        // Phase 8: --protect <filename>:<op_class>
        if (!strcmp(argv[i], "--protect") && i + 1 < argc) {
            if (protect_argc < 32) {
                char *arg = argv[++i];
                char *colon = strrchr(arg, ':');
                if (!colon) {
                    fprintf(stderr, "[!!] --protect format: <filename>:<op>  (pl. bio_memory.json:write)\n");
                    continue;
                }
                *colon = '\0';
                protect_file[protect_argc] = arg;
                protect_op[protect_argc]   = parse_op_class(colon + 1);
                protect_argc++;
            }
            continue;
        }
        if (argv[i][0] != '-') obj_path = argv[i];
    }

    // ─── Fejléc ───
    printf("═══════════════════════════════════════════════════════\n");
    printf(" DCC Ring 0 — Fázis 8+9: Challenge Paritás\n");
    printf(" Phase 8: Intent Binding + File Axiom Map\n");
    printf(" Phase 9: Atomi Tranzakció (TOCTOU zárás)\n");
    printf(" Iras:    %s\n", blocking        ? RED "BLOCKING" RESET : GREEN "log-only" RESET);
    printf(" Olvs:    %s\n", read_guard_mode == GUARD_BLOCK ? RED "BLOCKING" RESET :
                             read_guard_mode == GUARD_LOG   ? YELLOW "log-only" RESET : "off");
    printf(" Halozat: %s\n", net_guard_mode  == GUARD_BLOCK ? RED "BLOCKING" RESET :
                             net_guard_mode  == GUARD_LOG   ? YELLOW "log-only" RESET : "off");
    printf(" Exec:    %s\n", exec_guard_mode == GUARD_BLOCK ? RED "BLOCKING" RESET :
                             exec_guard_mode == GUARD_LOG   ? YELLOW "log-only" RESET : "off");
    printf(" TOCTOU:  " ORANGE "MINDIG HARD BLOCK" RESET " (konfiguralhatatlan)\n");
    printf("═══════════════════════════════════════════════════════\n\n");

    // ─── 1. BPF objektum ───
    printf("[1/5] BPF objektum: %s\n", obj_path);
    struct bpf_object *obj = bpf_object__open(obj_path);
    if (!obj || libbpf_get_error(obj)) {
        fprintf(stderr, "HIBA: %s nem nyithato meg\n", obj_path);
        return 1;
    }

    // ─── 2. Kernel betöltés ───
    printf("[2/5] Kernelbe toltes (BTF CO-RE)...\n");
    int err = bpf_object__load(obj);
    if (err) {
        fprintf(stderr, "HIBA: betoltes sikertelen: %d (%s)\n", err, strerror(-err));
        bpf_object__close(obj);
        return 1;
    }
    printf("[OK]  Programok betoltve\n");

    // ─── 3. Map konfiguráció ───
    printf("[3/5] Konfiguracio...\n");

    struct bpf_map *cfg_map = bpf_object__find_map_by_name(obj, "config_map");
    if (cfg_map) {
        int fd = bpf_map__fd(cfg_map);
        __u32 key = 0;
        struct config_t cfg = {
            .log_only   = blocking        ? 0 : 1,
            .read_guard = (__u32)read_guard_mode,
            .net_guard  = (__u32)net_guard_mode,
            .exec_guard = (__u32)exec_guard_mode,
        };
        bpf_map_update_elem(fd, &key, &cfg, BPF_ANY);
    }

    struct bpf_map *pid_map = bpf_object__find_map_by_name(obj, "loader_pid_map");
    if (pid_map) {
        int fd = bpf_map__fd(pid_map);
        __u32 key = 0, self_pid = (__u32)getpid();
        bpf_map_update_elem(fd, &key, &self_pid, BPF_ANY);
        printf("[OK]  self-exemption: pid=%u\n", self_pid);
    }

    struct bpf_map *wl_map = bpf_object__find_map_by_name(obj, "whitelist_map");
    if (wl_map) {
        int fd = bpf_map__fd(wl_map);
        __u32 val = 1;
        const char *builtin[] = { "rs:main Q:Reg", "systemd-journal", NULL };
        for (int i = 0; builtin[i]; i++) {
            char key[16] = {};
            strncpy(key, builtin[i], 15);
            bpf_map_update_elem(fd, key, &val, BPF_ANY);
        }
        for (int i = 0; i < wl_argc; i++) {
            char key[16] = {};
            strncpy(key, whitelist[i], 15);
            bpf_map_update_elem(fd, key, &val, BPF_ANY);
            printf("[OK]  whitelist += '%s'\n", whitelist[i]);
        }
    }

    struct bpf_map *ea_map = bpf_object__find_map_by_name(obj, "exec_whitelist_map");
    if (ea_map) {
        int fd = bpf_map__fd(ea_map);
        __u32 val = 1;
        for (int i = 0; i < ea_argc; i++) {
            char key[16] = {};
            strncpy(key, exec_allow[i], 15);
            bpf_map_update_elem(fd, key, &val, BPF_ANY);
            printf("[OK]  exec-allow += '%s'\n", exec_allow[i]);
        }
    }

    // Phase 8: file_axiom_map feltöltése
    struct bpf_map *ax_map = bpf_object__find_map_by_name(obj, "file_axiom_map");
    if (ax_map) {
        int fd = bpf_map__fd(ax_map);
        for (int i = 0; i < protect_argc; i++) {
            char key[16] = {};
            strncpy(key, protect_file[i], 15);
            bpf_map_update_elem(fd, key, &protect_op[i], BPF_ANY);
            const char *op_name = (protect_op[i] == OP_BLOCK) ? "BLOCK" :
                                  (protect_op[i] == OP_ANY)   ? "ANY"   :
                                  (protect_op[i] == OP_WRITE)  ? "WRITE" : "CUSTOM";
            printf("[OK]  axiom: '%s' → %s\n", protect_file[i], op_name);
        }
        if (protect_argc == 0)
            printf("[--]  axiom: nincs fajl-specifikus vedelem (csak token kell)\n");
    }

    // token_map FREEZE
    struct bpf_map *tok_map = bpf_object__find_map_by_name(obj, "token_map");
    if (tok_map) {
        if (bpf_map_freeze(bpf_map__fd(tok_map)) == 0)
            printf("[OK]  token_map: FROZEN\n");
        else
            printf("[--]  token_map: freeze sikertelen (%s)\n", strerror(errno));
    }

    // ─── 4. Programok csatlakoztatása ───
    printf("[4/5] Programok csatlakoztatasa...\n");

#define MAX_LINKS 8
    struct bpf_link *links[MAX_LINKS] = {0};
    int nl = 0;

    links[nl++] = attach_prog(obj, "dcc_causality_monitor");
    links[nl++] = attach_prog(obj, "dcc_fork_inherit");
    links[nl++] = attach_prog(obj, "dcc_axiom_validator");
    links[nl++] = attach_prog(obj, "dcc_read_guard");
    links[nl++] = attach_prog(obj, "dcc_network_guard");
    links[nl++] = attach_prog(obj, "dcc_exec_guard");

    int any_attached = 0;
    for (int i = 0; i < nl; i++) if (links[i]) any_attached++;
    if (!any_attached) {
        fprintf(stderr, "HIBA: egyetlen program sem csatlakoztatva\n");
        bpf_object__close(obj);
        return 1;
    }
    printf("[OK]  %d program aktiv\n", any_attached);

    // ─── 5. Ring buffer ───
    struct bpf_map *ring_map = bpf_object__find_map_by_name(obj, "audit_buf");
    if (!ring_map) { fprintf(stderr, "HIBA: audit_buf hianyzik\n"); return 1; }
    struct ring_buffer *rb = ring_buffer__new(bpf_map__fd(ring_map),
                                               handle_event, &quiet, NULL);
    if (!rb) { fprintf(stderr, "HIBA: ring buffer\n"); return 1; }

    printf("[5/5] Audit ring buffer aktiv\n\n");
    printf("─────────────────────────────────────────────────────────────\n");
    printf("Ido       Verdict       Guard   PID      Folyamat\n");
    printf("─────────────────────────────────────────────────────────────\n");

    signal(SIGINT,  handle_sigint);
    signal(SIGTERM, handle_sigint);

    while (running) {
        err = ring_buffer__poll(rb, 200);
        if (err < 0 && err != -EINTR) {
            fprintf(stderr, "Ring buffer hiba: %d\n", err);
            break;
        }
    }

    print_summary();

    ring_buffer__free(rb);
    for (int i = 0; i < nl; i++)
        if (links[i]) bpf_link__destroy(links[i]);
    bpf_object__close(obj);
    printf("\n[OK] DCC loader leallitva.\n");
    return 0;
}
