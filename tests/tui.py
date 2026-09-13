#!/usr/bin/env python3
"""Drive a real pi TUI in a PTY to smoke-test the resume-plus picker.

Usage:
  python3 tests/tui.py                        # /r flow, default All panel, Tab scopes
  python3 tests/tui.py <cwd> <pin-folder>     # also assert the current cwd folder is pinned first
  python3 tests/tui.py --startup-flag         # pi --rr opens the picker with no input, then resume works
"""
import os, pty, select, subprocess, sys, time, re, signal, fcntl, termios, struct

ANSI = re.compile(rb"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b[>=][0-9]?u?")

def strip_ansi(data: bytes) -> str:
    return ANSI.sub(b"", data).decode("utf-8", "replace")

CWD = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "/tmp"
PIN = next((a for a in sys.argv[2:] if not a.startswith("--")), None)
FLAG_MODE = "--startup-flag" in sys.argv

cmd = ["pi", "--no-session"] + (["--rr"] if FLAG_MODE else [])
master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
proc = subprocess.Popen(cmd, stdin=slave, stdout=slave, stderr=slave,
                        cwd=CWD, close_fds=True, start_new_session=True)
os.close(slave)
log = bytearray()

def pump(seconds: float) -> None:
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.1)
        if r:
            try: log.extend(os.read(master, 65536))
            except OSError: break

def send(data: bytes, settle: float = 0.6) -> None:
    os.write(master, data)
    pump(settle)

def wait_for(probe: str, seconds: float) -> bool:
    """Pump until `probe` has been rendered (startup/loading times vary)."""
    end = time.time() + seconds
    while time.time() < end:
        pump(0.25)
        if probe in strip_ansi(bytes(log)):
            return True
    return False

try:
    if FLAG_MODE:
        # No input is sent: the --rr flag must open the picker by itself.
        wait_for("Resume Session (All)", 30)
        wait_for("📁", 30)
        snap1 = bytes(log)
        send(b"\x1b[B", 1)        # folder row -> first session row
        send(b"\r", 1)
        wait_for("Resumed session", 15)
        snap_resumed = bytes(log)
        send(b"\x03", 1)
        send(b"\x03", 1)
    else:
        pump(6)                    # startup + extension load
        send("/r".encode())
        send(b"\r", 3)             # open selector (defaults to All panel)
        snap1 = bytes(log)
        send(b"\t", 2)             # switch to Current Folder scope
        snap2 = bytes(log)
        send(b"\t", 2)             # back to All (cached)
        snap3 = bytes(log)
        send(b"\x1b[1;2B", 1)      # Shift+Down jump between projects
        send(b"\x1b", 1.5)         # cancel selector
        send(b"\x03", 1)           # ctrl+c
        send(b"\x03", 1)
finally:
    try: proc.terminate()
    except Exception: pass
    try: proc.wait(timeout=5)
    except Exception:
        try: os.killpg(proc.pid, signal.SIGKILL)
        except Exception: pass

open("/tmp/resume-plus-tui.log", "w").write(strip_ansi(bytes(log)))

def check(name: str, snap: bytes, probes: list) -> bool:
    text = strip_ansi(snap)
    missing = [p for p in probes if p not in text]
    print(("PASS" if not missing else "FAIL"), name, ("missing: " + ", ".join(missing)) if missing else "")
    return not missing

ok = True
if FLAG_MODE:
    # With --rr the picker opens during pi's startup, so the startup banner
    # (which carries the "resume-plus" extension list) is deferred and absent.
    # The auto-opened picker itself is the load proof.
    ok &= check("--rr opens the picker with no input", snap1, ["Resume Session (All)", "📁"])
    ok &= check("selecting in the auto-opened picker resumes that session", snap_resumed, ["Resumed session"])
else:
    ok &= check("startup loads resume-plus", bytes(log), ["resume-plus"])
    ok &= check("/r opens selector defaulting to All with folder roots", snap1,
                ["Resume Session (All)", "📁", "Sort:", "Threaded", "regex", "rename", "delete", "shift+enter"])
    ok &= check("Tab switches to Current Folder scope", snap2, ["Resume Session (Current Folder)"])
    ok &= check("Tab back to All keeps folder grouping", snap3, ["Resume Session (All)", "📁"])
    if PIN:
        first_folder = next((line for line in strip_ansi(snap1).splitlines() if "📁" in line), "")
        ok &= check("current cwd folder pinned first", first_folder.encode(), [PIN])
sys.exit(0 if ok else 1)
