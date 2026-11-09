"""Penklinė: natų nuotraukas ir PDF paverčia MusicXML failais.

Programa paleidžia mažą serverį tik šiame kompiuteryje (127.0.0.1) ir atidaro jo
langą per Microsoft Edge (programos režimu). Atpažinimą atlieka homr, peržiūrą Verovio.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import time
import traceback
import uuid
import webbrowser
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

from photo_prep import IMAGE_EXTS, prepare_image

FROZEN = getattr(sys, "frozen", False)  # paleista kaip Penkline.exe
if FROZEN:
    APP_DIR = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    ROOT_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "Penkline"
else:
    APP_DIR = Path(__file__).resolve().parent
    ROOT_DIR = APP_DIR.parent
ROOT_DIR.mkdir(parents=True, exist_ok=True)
WEB_DIR = APP_DIR / "web"
WORK_DIR = ROOT_DIR / "darbai"
OUTPUT_DIR = Path.home() / "Documents" / "Penklinė"
IS_WINDOWS = os.name == "nt"
NO_WINDOW = 0x08000000 if IS_WINDOWS else 0  # CREATE_NO_WINDOW

JOBS: dict[str, dict] = {}
LAST_PING = time.time()
# Slaptas raktas: tik mūsų langas jį žino, todėl kitos svetainės negali kreiptis į API.
TOKEN = uuid.uuid4().hex
PORT = 0


def engine_ready() -> bool:
    if FROZEN:
        return True
    return (ROOT_DIR / "engine" / "homr" / "main.py").is_file()


def homr_command(log_file: Path, inputs: list[str]) -> list[str]:
    if FROZEN:
        return [sys.executable, "--homr", "--log", str(log_file), "--no-title", *inputs]
    return [sys.executable, str(APP_DIR / "run_homr.py"), "--log", str(log_file),
            "--no-title", *inputs]


def run_homr_process(inputs: list[str], cwd: Path, on_line=None, should_stop=None,
                     on_start=None) -> int:
    """Paleidžia atpažinimą atskirame procese ir seka jo žurnalą."""
    cwd = Path(cwd).resolve()
    inputs = [str(Path(p).resolve()) for p in inputs]
    log_file = cwd / "homr.log"
    log_file.write_text("", encoding="utf-8")
    env = dict(os.environ, PYTHONIOENCODING="utf-8")
    proc = subprocess.Popen(homr_command(log_file, inputs), cwd=str(cwd), env=env,
                            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                            stderr=subprocess.DEVNULL, creationflags=NO_WINDOW)
    if on_start:
        on_start(proc)
    with open(log_file, encoding="utf-8", errors="replace") as fh:
        buf = ""
        while True:
            chunk = fh.read()
            if chunk:
                buf += chunk
                *lines, buf = buf.split("\n")
                for line in lines:
                    if line.strip() and on_line:
                        on_line(line.rstrip())
            elif proc.poll() is not None:
                if buf.strip() and on_line:
                    on_line(buf.rstrip())
                break
            else:
                if should_stop and should_stop():
                    proc.kill()
                time.sleep(0.3)
    code = proc.wait()
    crash = cwd / "homr-crash.log"
    if crash.exists() and on_line:
        for line in crash.read_text(encoding="utf-8", errors="replace").splitlines():
            on_line(line)
    return code


# ---------------------------------------------------------------- atpažinimas


def log(job: dict, text: str) -> None:
    job["log"].append(text)
    job["log"] = job["log"][-200:]


def update_progress(job: dict, line: str) -> None:
    low = line.lower()
    if "downloading" in low:
        job["stage"] = "Siunčiami atpažinimo modeliai"
    elif line.startswith("====="):
        job["page"] = job.get("page", 0) + 1
        total = job.get("pages")
        job["stage"] = (f"Atpažįstamas {job['page']} puslapis iš {total}" if total
                        else f"Atpažįstamas {job['page']} puslapis")


def pdf_page_count(path: Path) -> int:
    try:
        import pypdfium2

        return len(pypdfium2.PdfDocument(str(path)))
    except Exception:
        return 0


def run_job(job_id: str, files: list[str], flatten: bool) -> None:
    job = JOBS[job_id]
    job_dir = WORK_DIR / job_id
    try:
        if not engine_ready():
            raise RuntimeError("Atpažinimo variklis neįdiegtas. Paleisk Idiegti.bat iš naujo.")
        job["stage"] = "Ruošiami lapai"
        inputs: list[str] = []
        pages = 0
        for name in files:
            src = job_dir / "ikelta" / name
            if src.suffix.lower() == ".pdf":
                dst = job_dir / src.name
                shutil.copy(src, dst)
                inputs.append(str(dst))
                pages += pdf_page_count(dst)
            elif src.suffix.lower() in IMAGE_EXTS:
                out, note = prepare_image(src, job_dir, flatten=flatten)
                if note:
                    log(job, f"{src.name}: {note}")
                inputs.append(str(out))
                pages += 1
            else:
                raise RuntimeError(f"{src.name}: tokio failo tipo atidaryti negalima.")

        job["pages"] = pages or None
        job["stage"] = "Atpažįstamos natos"

        def on_line(line: str) -> None:
            log(job, line)
            update_progress(job, line)

        code = run_homr_process(inputs, job_dir, on_line=on_line,
                                should_stop=lambda: job.get("cancelled", False),
                                on_start=lambda p: job.__setitem__("proc", p))
        if job.get("cancelled"):
            raise RuntimeError("Atšaukta.")
        results = sorted(job_dir.glob("*.musicxml"), key=lambda p: p.stat().st_mtime)
        if code != 0 or not results:
            raise RuntimeError("Natų atpažinti nepavyko. Nufotografuok lapą tiesiai iš viršaus, "
                               "prie gero apšvietimo, ir bandyk dar kartą.")
        musicxml = results[-1]

        # Gražus pavadinimas pagal pirmą failą.
        base = re.sub(r"^\d+_", "", Path(files[0]).stem) or "natos"
        final = job_dir / "rezultatas.musicxml"
        if musicxml != final:
            shutil.move(str(musicxml), final)
        job["musicxml"] = str(final)
        job["name"] = base

        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
        saved = unique_path(OUTPUT_DIR / f"{base}.musicxml")
        shutil.copy(final, saved)
        job["saved"] = str(saved)
        job["stage"] = "Baigta"
        job["status"] = "done"
    except Exception as exc:
        job["status"] = "error"
        job["error"] = str(exc)
        log(job, traceback.format_exc())


def unique_path(path: Path) -> Path:
    if not path.exists():
        return path
    i = 2
    while True:
        cand = path.with_name(f"{path.stem} ({i}){path.suffix}")
        if not cand.exists():
            return cand
        i += 1


def preview(job: dict) -> dict:
    import verovio

    tk = verovio.toolkit()
    tk.setOptions({
        "pageWidth": 2100, "pageHeight": 2970, "scale": 40, "adjustPageHeight": True,
        "footer": "none", "header": "auto", "breaks": "auto",
    })
    if not tk.loadFile(job["musicxml"]):
        raise RuntimeError("Nepavyko atvaizduoti natų.")
    pages = [tk.renderToSVG(i) for i in range(1, tk.getPageCount() + 1)]
    midi = tk.renderToMIDI()
    return {"pages": pages, "midi": midi}


def open_file(path: Path) -> None:
    """Atidaro failą programa, kuri sistemoje priskirta tokiems failams."""
    if IS_WINDOWS:
        try:
            os.startfile(str(path))  # type: ignore[attr-defined]
        except OSError as exc:
            raise RuntimeError("Kompiuteryje nėra programos, kuri atidarytų MusicXML failus.") from exc
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


def show_in_folder(path: Path) -> None:
    if IS_WINDOWS and path.is_file():
        subprocess.Popen(["explorer", "/select,", str(path)])
        return
    folder = path if path.is_dir() else path.parent
    folder.mkdir(parents=True, exist_ok=True)
    open_file(folder)


# ---------------------------------------------------------------- serveris


class Handler(BaseHTTPRequestHandler):
    server_version = "Penkline/1.1"

    def log_message(self, *args) -> None:  # tylus režimas
        pass

    # --- pagalbinės
    def send_json(self, data, code: int = 200) -> None:
        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def send_file(self, path: Path, ctype: str, download_name: str | None = None) -> None:
        data = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        if download_name:
            self.send_header("Content-Disposition",
                             f"attachment; filename*=UTF-8''{quote(download_name)}")
        self.end_headers()
        self.wfile.write(data)

    def read_json(self) -> dict:
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}")

    def job(self, job_id: str) -> dict:
        job = JOBS.get(job_id)
        if job is None:
            raise KeyError("Darbas nerastas.")
        return job

    def allowed(self, parts: list[str], query: dict) -> bool:
        if self.headers.get("Host") not in (f"127.0.0.1:{PORT}", f"localhost:{PORT}"):
            return False
        if parts and parts[0] == "api":
            token = self.headers.get("X-Token") or query.get("t", [""])[0]
            return token == TOKEN
        return True

    # --- GET
    def do_GET(self) -> None:
        url = urlparse(self.path)
        parts = [p for p in url.path.split("/") if p]
        if not self.allowed(parts, parse_qs(url.query)):
            return self.send_json({"error": "draudžiama"}, 403)
        try:
            if not parts:
                return self.send_file(WEB_DIR / "index.html", "text/html; charset=utf-8")
            if parts == ["api", "status"]:
                return self.send_json({"engine": engine_ready(), "output_dir": str(OUTPUT_DIR)})
            if len(parts) == 3 and parts[:2] == ["api", "job"]:
                job = self.job(parts[2])
                if not job:
                    return self.send_json({"error": "nėra"}, 404)
                return self.send_json({k: job.get(k) for k in
                                       ("status", "stage", "error", "saved", "name", "page",
                                        "pages")} |
                                      {"log": job["log"][-15:]})
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "preview":
                job = self.job(parts[2])
                return self.send_json(preview(job))
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "download":
                job = self.job(parts[2])
                return self.send_file(Path(job["musicxml"]),
                                      "application/vnd.recordare.musicxml+xml",
                                      f"{job['name']}.musicxml")
            self.send_json({"error": "nerasta"}, 404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, 500)

    # --- POST
    def do_POST(self) -> None:
        global LAST_PING
        url = urlparse(self.path)
        parts = [p for p in url.path.split("/") if p]
        if not self.allowed(parts, parse_qs(url.query)) or not parts or parts[0] != "api":
            return self.send_json({"error": "draudžiama"}, 403)
        try:
            if parts == ["api", "ping"]:
                LAST_PING = time.time()
                return self.send_json({"ok": True})
            if parts == ["api", "new"]:
                job_id = uuid.uuid4().hex[:12]
                (WORK_DIR / job_id / "ikelta").mkdir(parents=True, exist_ok=True)
                JOBS[job_id] = {"status": "uploading", "stage": "", "log": []}
                return self.send_json({"id": job_id})
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "upload":
                job_id = parts[2]
                if job_id not in JOBS:
                    return self.send_json({"error": "nėra"}, 404)
                name = os.path.basename(unquote(parse_qs(url.query)["name"][0]))
                n = int(self.headers.get("Content-Length") or 0)
                (WORK_DIR / job_id / "ikelta" / name).write_bytes(self.rfile.read(n))
                return self.send_json({"ok": True})
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "start":
                job_id = parts[2]
                body = self.read_json()
                JOBS[job_id].update(status="running", stage="Pradedama…")
                threading.Thread(target=run_job, daemon=True,
                                 args=(job_id, body["files"], body.get("flatten", True))).start()
                return self.send_json({"ok": True})
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "cancel":
                job = self.job(parts[2])
                job["cancelled"] = True
                if job.get("proc"):
                    job["proc"].kill()
                return self.send_json({"ok": True})
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "open":
                open_file(Path(self.job(parts[2])["saved"]))
                return self.send_json({"ok": True})
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "reveal":
                show_in_folder(Path(self.job(parts[2])["saved"]))
                return self.send_json({"ok": True})
            if parts == ["api", "open-folder"]:
                show_in_folder(OUTPUT_DIR)
                return self.send_json({"ok": True})
            self.send_json({"error": "nerasta"}, 404)
        except Exception as exc:
            self.send_json({"error": str(exc)}, 500)


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def open_window(url: str) -> None:
    if IS_WINDOWS:
        edge_paths = [
            os.path.join(os.environ.get("ProgramFiles(x86)", ""), r"Microsoft\Edge\Application\msedge.exe"),
            os.path.join(os.environ.get("ProgramFiles", ""), r"Microsoft\Edge\Application\msedge.exe"),
        ]
        for edge in edge_paths:
            if os.path.isfile(edge):
                profile = ROOT_DIR / "langas"
                subprocess.Popen([edge, f"--app={url}", f"--user-data-dir={profile}",
                                  "--window-size=1200,860", "--no-first-run"])
                return
    webbrowser.open(url)


def watchdog(server: ThreadingHTTPServer) -> None:
    """Uždaro programą, kai jos langas uždaromas (nebegauna signalų)."""
    while True:
        time.sleep(5)
        busy = any(j.get("status") == "running" for j in JOBS.values())
        if not busy and time.time() - LAST_PING > 45:
            server.shutdown()
            return


def selftest(image: str, out_dir: str) -> int:
    """Patikra kūrimo metu: atpažįsta paveikslėlį ir atvaizduoja rezultatą."""
    out = Path(out_dir).resolve()
    out.mkdir(parents=True, exist_ok=True)
    # Exe be konsolės neturi stdout, todėl ataskaita rašoma į failą.
    sys.stdout = sys.stderr = open(out / "selftest.log", "w", encoding="utf-8", buffering=1)  # noqa: SIM115
    src = Path(image).resolve()
    if src.suffix.lower() == ".pdf":
        inputs = [str(shutil.copy(src, out / src.name))]
    else:
        prepared, _ = prepare_image(src, out, flatten=True)
        inputs = [str(prepared)]
    lines: list[str] = []
    code = run_homr_process(inputs, out, on_line=lines.append)
    print("\n".join(lines[-30:]))
    results = list(out.glob("*.musicxml"))
    if code != 0 or not results:
        print(f"SELFTEST FAIL: homr code={code}, musicxml={len(results)}")
        return 1
    xml = results[0].read_text(encoding="utf-8")
    notes = xml.count("<note")
    pv = preview({"musicxml": str(results[0])})
    (out / "preview.svg").write_text(pv["pages"][0], encoding="utf-8")
    print(f"SELFTEST OK: notes={notes}, pages={len(pv['pages'])}, midi={bool(pv['midi'])}")
    return 0 if notes > 10 and pv["pages"] else 1


def main() -> None:
    global LAST_PING, PORT
    if len(sys.argv) > 1 and sys.argv[1] == "--homr":
        from homr_entry import run

        sys.exit(run(sys.argv[2:]))
    if len(sys.argv) > 1 and sys.argv[1] == "--selftest":
        sys.exit(selftest(sys.argv[2], sys.argv[3]))
    WORK_DIR.mkdir(exist_ok=True)
    # Senų darbų valymas (vyresni nei 7 d.)
    for d in WORK_DIR.iterdir():
        try:
            if time.time() - d.stat().st_mtime > 7 * 86400:
                shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass
    PORT = free_port()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    url = f"http://127.0.0.1:{PORT}/#t={TOKEN}"
    print("Penklinė veikia:", url)
    LAST_PING = time.time() + 60  # laikas langui atsidaryti
    threading.Thread(target=watchdog, args=(server,), daemon=True).start()
    if "--no-window" not in sys.argv:
        open_window(url)
    server.serve_forever()


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    main()
