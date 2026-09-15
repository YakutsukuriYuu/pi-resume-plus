#!/usr/bin/env python3
"""Drive a real pi TUI in a PTY to smoke-test the resume-plus picker.

Usage:
  python3 tests/tui.py                        # /r flow: default All panel, Tab scopes
  python3 tests/tui.py <cwd> <pin-folder>     # also assert the current cwd folder is pinned first
  python3 tests/tui.py --startup-flag         # pi --rr opens the picker with no input, then resume works
  python3 tests/tui.py --startup-cancel       # closing the auto-opened picker (Esc / Ctrl+C) restores typing
"""
import os, pty, select, subprocess, sys, time, re, signal, fcntl, termios, struct

ANSI = re.compile(rb"\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07|\x1b[()][0-9A-B]|\x1b[>=][0-9]?u?")

def strip_ansi(data: bytes) -> str:
    return ANSI.sub(b"", data).decode("utf-8", "replace")


class Session:
    """A pi TUI running in a PTY, with helpers to drive and inspect it."""

    def __init__(self, args, cwd="/tmp"):
        self.master, slave = pty.openpty()
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 140, 0, 0))
        self.proc = subprocess.Popen(["pi", *args], stdin=slave, stdout=slave, stderr=slave,
                                     cwd=cwd, close_fds=True, start_new_session=True)
        os.close(slave)
        self.log = bytearray()

    def pump(self, seconds):
        end = time.time() + seconds
        while time.time() < end:
            r, _, _ = select.select([self.master], [], [], 0.1)
            if r:
                try: self.log.extend(os.read(self.master, 65536))
                except OSError: return

    def send(self, data, settle=0.6):
        os.write(self.master, data)
        self.pump(settle)

    def text(self, tail=None):
        data = bytes(self.log) if tail is None else bytes(self.log[-tail:])
        return strip_ansi(data)

    def wait_for(self, probe, seconds):
        """Pump until `probe` shows up anywhere in the captured output."""
        end = time.time() + seconds
        while time.time() < end:
            self.pump(0.25)
            if probe in self.text():
                return True
        return False

    def wait_until(self, predicate, seconds):
        end = time.time() + seconds
        while time.time() < end:
            self.pump(0.25)
            if predicate(self.text()):
                return True
        return False

    def close(self):
        try: self.proc.terminate()
        except Exception: pass
        try: self.proc.wait(timeout=5)
        except Exception:
            try: os.killpg(self.proc.pid, signal.SIGKILL)
            except Exception: pass


def check(name, ok, detail=""):
    print(("PASS" if ok else "FAIL"), name, detail)
    return ok


def mode_startup_flag(cwd):
    s = Session(["--no-session", "--rr"], cwd)
    try:
        s.pump(1)
        # No input is sent: the --rr flag must open the picker by itself.
        opened = s.wait_for("Resume Session (All)", 30) and s.wait_for("📁", 30)
        ok = check("--rr opens the picker with no input", opened)
        s.send(b"\x1b[B", 1)      # folder row -> first session row
        s.send(b"\r", 1)
        resumed = s.wait_until(lambda t: "Resumed session" in t[-4000:], 15)
        ok &= check("selecting in the auto-opened picker resumes that session", resumed)
        return ok
    finally:
        s.close()


def mode_startup_cancel(cwd):
    """Closing the startup picker must hand the keyboard back to the editor."""
    ok = True
    for key, label in ((b"\x1b", "Esc"), (b"\x03", "Ctrl+C")):
        s = Session(["--no-session", "--rr"], cwd)
        try:
            s.pump(1)
            if not s.wait_for("Resume Session (All)", 30):
                ok &= check(f"{label}: picker opened", False)
                continue
            s.send(key, 2)
            closed = s.wait_until(lambda t: "Resume Session" not in t[-4000:], 8)
            ok &= check(f"{label} closes the startup picker", closed)
            s.send(b"hello", 1)
            typed = s.wait_until(lambda t: "hello" in t[-4000:], 6)
            ok &= check(f"{label}: typing works right after closing", typed)
            s.send(b"\x03", 1)
            s.send(b"\x03", 1)
        finally:
            s.close()
    return ok


def mode_normal(cwd, pin):
    s = Session(["--no-session"], cwd)
    try:
        s.pump(6)                  # startup + extension load
        s.send("/r".encode())
        s.send(b"\r", 3)           # open selector (defaults to All panel)
        snap1 = bytes(s.log)
        s.send(b"\t", 2)           # switch to Current Folder scope
        snap2 = bytes(s.log)
        s.send(b"\t", 2)           # back to All (cached)
        snap3 = bytes(s.log)
        s.send(b"\x1b[1;2B", 1)    # Shift+Down jump between projects
        s.send(b"\x1b", 1.5)       # cancel selector
        typable = s.wait_until(lambda t: "Resume Session" not in t[-4000:], 5)
        s.send(b"hello", 1)
        typable &= s.wait_until(lambda t: "hello" in t[-4000:], 6)
    finally:
        s.close()
    ok = check("startup loads resume-plus", "resume-plus" in strip_ansi(bytes(s.log)))
    ok &= check("/r opens selector defaulting to All with folder roots", all(
        p in strip_ansi(snap1) for p in ["Resume Session (All)", "📁", "Sort:", "Threaded", "regex", "rename", "delete", "shift+enter"]))
    ok &= check("Tab switches to Current Folder scope", "Resume Session (Current Folder)" in strip_ansi(snap2))
    ok &= check("Tab back to All keeps folder grouping",
                all(p in strip_ansi(snap3) for p in ["Resume Session (All)", "📁"]))
    ok &= check("/r cancel also restores typing", typable)
    if pin:
        first_folder = next((l for l in strip_ansi(snap1).splitlines() if "📁" in l), "")
        ok &= check("current cwd folder pinned first", pin in first_folder, f"(first folder line: {first_folder.strip()[:60]})")
    return ok


def main():
    args = sys.argv[1:]
    if "--startup-flag" in args:
        return mode_startup_flag("/tmp")
    if "--startup-cancel" in args:
        return mode_startup_cancel("/tmp")
    cwd = args[0] if args and not args[0].startswith("--") else "/tmp"
    pin = next((a for a in args[1:] if not a.startswith("--")), None)
    return mode_normal(cwd, pin)


if __name__ == "__main__":
    sys.exit(0 if main() else 1)
