#!/usr/bin/env python3
"""Drive a real pi TUI in a PTY to smoke-test the /r selector."""
import os, pty, select, subprocess, sys, time, re, signal, fcntl, termios, struct

master, slave = pty.openpty()
fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
proc = subprocess.Popen(["pi"], stdin=slave, stdout=slave, stderr=slave,
                        cwd="/tmp", close_fds=True, start_new_session=True)
os.close(slave)
log = bytearray()

def pump(seconds):
    end = time.time() + seconds
    while time.time() < end:
        r, _, _ = select.select([master], [], [], 0.1)
        if r:
            try: log.extend(os.read(master, 65536))
            except OSError: break

def send(data, settle=0.6):
    os.write(master, data)
    pump(settle)

try:
    pump(6)                       # startup + extension load
    send("/r".encode())
    send(b"\r", 3)                # open selector
    snap1 = bytes(log)
    send(b"\t", 2)                # switch to All scope (folder grouping)
    snap2 = bytes(log)
    send(b"\x1b[1;2B", 1)         # Shift+Down jump between projects
    snap3 = bytes(log)
    send(b"\x1b", 1.5)            # cancel selector
    send(b"\x03", 1)              # ctrl+c
    send(b"\x03", 1)
finally:
    try: proc.terminate()
    except Exception: pass
    try: proc.wait(timeout=5)
    except Exception:
        try: os.killpg(proc.pid, signal.SIGKILL)
        except Exception: pass

plain = re.sub(rb"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b[>=][0-9]?u?", b"",
               bytes(log)).decode("utf-8", "replace")
open("/tmp/resume-plus-tui.log", "w").write(plain)

def check(name, snap, probes):
    text = re.sub(rb"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b[>=][0-9]?u?", b"",
                  snap).decode("utf-8", "replace")
    missing = [p for p in probes if p not in text]
    print(("PASS" if not missing else "FAIL"), name, ("missing: " + ", ".join(missing)) if missing else "")
    return not missing

ok = True
ok &= check("startup loads resume-plus", bytes(log), ["resume-plus"])
ok &= check("/r opens native-parity selector (current scope)", snap1,
            ["Resume Session (Current Folder)", "Sort:", "Threaded", "regex", "rename", "delete"])
ok &= check("Tab switches to All with folder roots", snap2, ["Resume Session (All)"])
ok &= check("folder grouping renders project rows", snap2, ["📁"])
sys.exit(0 if ok else 1)
