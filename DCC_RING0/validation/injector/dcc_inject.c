/*
 * DCC Ring 0 — Userspace Attacker / Injector
 *
 * Runs as process "dcc_attacker" (or --comm override).
 * Provides all --mode operations needed by T01-T13.
 *
 * Compile (on Tokyo server):
 *   gcc -O2 -o /tmp/dcc_inject dcc_inject.c
 *
 * Modes:
 *   write-only          – write without IRQ
 *   irq-then-write      – inject IRQ then write
 *   irq-then-wait-write – inject IRQ, sleep --wait-ms, then write
 *   toctou              – IRQ → write fileA → write fileB (different inode)
 *   multi-write         – IRQ → write file → write same file → write pivot
 *   fork-depth          – IRQ at root, fork --depth times, deepest writes
 *   comm-spoof          – prctl(PR_SET_NAME, --comm) then write
 *   pid-recycle         – fork victim (gets IRQ), kill it, fork again, write
 *   map-flood           – NOT implemented here; done via bpftool in runner
 *   double-irq          – two rapid IRQs from same process, then write
 *
 * Exit codes:
 *   0 = write succeeded (syscall returned 0)
 *   1 = write blocked (syscall returned -EPERM or -EACCES)
 *   2 = usage / setup error
 */

#define _GNU_SOURCE
#include <errno.h>
#include <fcntl.h>
#include <linux/input.h>
#include <linux/uinput.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/prctl.h>
#include <sys/stat.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* ── Config ──────────────────────────────────────────────────────────────── */

static const char *g_mode     = "write-only";
static const char *g_file     = "/tmp/dcc_inject_test.txt";
static const char *g_file_b   = NULL;   /* toctou second file */
static const char *g_pivot    = NULL;   /* multi-write pivot  */
static const char *g_comm     = "dcc_attacker";
static int         g_wait_ms  = 550;
static int         g_depth    = 4;
static int         g_op_class = -1;     /* -1 = default (not used in kernel path) */

/* ── uinput IRQ injection ─────────────────────────────────────────────────── */

static int uinput_fd = -1;

static int uinput_open(void) {
    uinput_fd = open("/dev/uinput", O_WRONLY | O_NONBLOCK);
    if (uinput_fd < 0) {
        fprintf(stderr, "uinput open failed: %s\n", strerror(errno));
        return -1;
    }
    ioctl(uinput_fd, UI_SET_EVBIT,  EV_KEY);
    ioctl(uinput_fd, UI_SET_KEYBIT, KEY_A);

    struct uinput_setup usetup = {};
    usetup.id.bustype = BUS_USB;
    usetup.id.vendor  = 0x1;
    usetup.id.product = 0x1;
    strcpy(usetup.name, "dcc_inject_kbd");

    if (ioctl(uinput_fd, UI_DEV_SETUP, &usetup) < 0) {
        fprintf(stderr, "UI_DEV_SETUP failed: %s\n", strerror(errno));
        return -1;
    }
    if (ioctl(uinput_fd, UI_DEV_CREATE) < 0) {
        fprintf(stderr, "UI_DEV_CREATE failed: %s\n", strerror(errno));
        return -1;
    }
    usleep(100000);   /* 100ms settle */
    return 0;
}

static void uinput_close(void) {
    if (uinput_fd >= 0) {
        ioctl(uinput_fd, UI_DEV_DESTROY);
        close(uinput_fd);
        uinput_fd = -1;
    }
}

static void emit_event(int type, int code, int value) {
    struct input_event ev = {};
    clock_gettime(CLOCK_MONOTONIC, (struct timespec *)&ev.time);
    ev.type  = type;
    ev.code  = code;
    ev.value = value;
    write(uinput_fd, &ev, sizeof(ev));
}

static int inject_irq(void) {
    if (uinput_fd < 0 && uinput_open() < 0) return -1;
    emit_event(EV_KEY, KEY_A, 1);  /* press */
    emit_event(EV_SYN, SYN_REPORT, 0);
    emit_event(EV_KEY, KEY_A, 0);  /* release */
    emit_event(EV_SYN, SYN_REPORT, 0);
    usleep(5000);   /* 5ms settle for BPF processing */
    return 0;
}

/* ── File write ──────────────────────────────────────────────────────────── */

static int try_write(const char *path) {
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    if (fd < 0) {
        if (errno == EPERM || errno == EACCES) return 1;  /* blocked */
        /* file doesn't exist yet: create it */
        fd = open(path, O_WRONLY | O_CREAT, 0644);
        if (fd < 0) {
            if (errno == EPERM || errno == EACCES) return 1;
            return 2;
        }
    }
    const char *data = "dcc_inject_test\n";
    ssize_t n = write(fd, data, strlen(data));
    int saved = errno;
    close(fd);
    if (n < 0) {
        if (saved == EPERM || saved == EACCES) return 1;
        return 2;
    }
    return 0;  /* success */
}

/* ── Modes ───────────────────────────────────────────────────────────────── */

static void set_comm(const char *comm) {
    prctl(PR_SET_NAME, comm, 0, 0, 0);
}

static int mode_write_only(void) {
    set_comm(g_comm);
    return try_write(g_file);
}

static int mode_irq_then_write(void) {
    set_comm(g_comm);
    if (inject_irq() < 0) return 2;
    return try_write(g_file);
}

static int mode_irq_then_wait_write(void) {
    set_comm(g_comm);
    if (inject_irq() < 0) return 2;
    usleep((useconds_t)g_wait_ms * 1000);
    return try_write(g_file);
}

static int mode_toctou(void) {
    set_comm(g_comm);
    if (!g_file_b) { fprintf(stderr, "--file-b required\n"); return 2; }
    if (inject_irq() < 0) return 2;
    int r1 = try_write(g_file);     /* first write: consumes token, binds inode */
    if (r1 != 0) return r1;
    int r2 = try_write(g_file_b);   /* second write: different inode → should block */
    return r2;
}

static int mode_multi_write(void) {
    set_comm(g_comm);
    if (!g_pivot) { fprintf(stderr, "--pivot required\n"); return 2; }
    if (inject_irq() < 0) return 2;
    int r1 = try_write(g_file);    /* first: SAT + inode bind */
    if (r1 != 0) return 1;
    int r2 = try_write(g_file);    /* second same: multi-write SAT */
    if (r2 != 0) return 1;
    int r3 = try_write(g_pivot);   /* pivot: TX_ROLLBACK */
    return r3;
}

static int mode_fork_depth(void) {
    set_comm(g_comm);
    if (inject_irq() < 0) return 2;

    int depth = g_depth;
    for (int i = 0; i < depth; i++) {
        pid_t child = fork();
        if (child < 0) return 2;
        if (child == 0) {
            /* child continues the fork chain */
            set_comm(g_comm);
            continue;
        }
        /* parent waits */
        int status;
        waitpid(child, &status, 0);
        return WIFEXITED(status) ? WEXITSTATUS(status) : 2;
    }
    /* deepest child: try write */
    set_comm(g_comm);
    int ret = try_write(g_file);
    _exit(ret);
}

static int mode_comm_spoof(void) {
    set_comm(g_comm);    /* e.g. "bash" — spoof the whitelist name */
    return try_write(g_file);
}

static int mode_pid_recycle(void) {
    set_comm(g_comm);
    /* fork victim that injects IRQ then exits immediately */
    pid_t victim = fork();
    if (victim < 0) return 2;
    if (victim == 0) {
        inject_irq();
        _exit(0);
    }
    waitpid(victim, NULL, 0);
    /* hope pid is recycled for next fork within 500ms window */
    usleep(50000);   /* 50ms — very tight, probabilistic */
    pid_t attacker = fork();
    if (attacker < 0) return 2;
    if (attacker == 0) {
        set_comm(g_comm);
        int r = try_write(g_file);
        _exit(r);
    }
    int status;
    waitpid(attacker, &status, 0);
    return WIFEXITED(status) ? WEXITSTATUS(status) : 2;
}

static int mode_double_irq(void) {
    set_comm(g_comm);
    if (inject_irq() < 0) return 2;
    usleep(50000);   /* 50ms */
    if (inject_irq() < 0) return 2;
    return try_write(g_file);
}

/* ── Argument parsing ────────────────────────────────────────────────────── */

static void usage(void) {
    fprintf(stderr,
        "Usage: dcc_inject --mode <mode> [options]\n"
        "Modes: write-only, irq-then-write, irq-then-wait-write, toctou,\n"
        "       multi-write, fork-depth, comm-spoof, pid-recycle, double-irq\n"
        "Options:\n"
        "  --file <path>      target file (default: /tmp/dcc_inject_test.txt)\n"
        "  --file-b <path>    second file for toctou\n"
        "  --pivot <path>     pivot file for multi-write\n"
        "  --comm <name>      process comm name (default: dcc_attacker)\n"
        "  --wait-ms <n>      wait before write (default: 550)\n"
        "  --depth <n>        fork depth (default: 4)\n"
        "  --op-class <n>     token op_class override (informational only)\n"
    );
}

int main(int argc, char **argv) {
    for (int i = 1; i < argc; i++) {
        if      (!strcmp(argv[i], "--mode")     && i+1 < argc) g_mode     = argv[++i];
        else if (!strcmp(argv[i], "--file")     && i+1 < argc) g_file     = argv[++i];
        else if (!strcmp(argv[i], "--file-a")   && i+1 < argc) g_file     = argv[++i];
        else if (!strcmp(argv[i], "--file-b")   && i+1 < argc) g_file_b   = argv[++i];
        else if (!strcmp(argv[i], "--pivot")    && i+1 < argc) g_pivot    = argv[++i];
        else if (!strcmp(argv[i], "--comm")     && i+1 < argc) g_comm     = argv[++i];
        else if (!strcmp(argv[i], "--wait-ms")  && i+1 < argc) g_wait_ms  = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--depth")    && i+1 < argc) g_depth    = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--op-class") && i+1 < argc) g_op_class = atoi(argv[++i]);
        else if (!strcmp(argv[i], "--help"))  { usage(); return 0; }
        else { fprintf(stderr, "Unknown arg: %s\n", argv[i]); usage(); return 2; }
    }

    int ret;
    if      (!strcmp(g_mode, "write-only"))           ret = mode_write_only();
    else if (!strcmp(g_mode, "irq-then-write"))        ret = mode_irq_then_write();
    else if (!strcmp(g_mode, "irq-then-wait-write"))   ret = mode_irq_then_wait_write();
    else if (!strcmp(g_mode, "toctou"))                ret = mode_toctou();
    else if (!strcmp(g_mode, "multi-write"))           ret = mode_multi_write();
    else if (!strcmp(g_mode, "fork-depth"))            ret = mode_fork_depth();
    else if (!strcmp(g_mode, "comm-spoof"))            ret = mode_comm_spoof();
    else if (!strcmp(g_mode, "pid-recycle"))           ret = mode_pid_recycle();
    else if (!strcmp(g_mode, "double-irq"))            ret = mode_double_irq();
    else { fprintf(stderr, "Unknown mode: %s\n", g_mode); usage(); ret = 2; }

    uinput_close();
    return ret;
}
