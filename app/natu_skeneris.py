"""Natų skeneris: nuotraukas ir PDF paverčia elektroninėmis natomis.

Programa paleidžia mažą serverį tik šiame kompiuteryje (127.0.0.1) ir atidaro jo
langą per Microsoft Edge (programos režimu). Atpažinimą atlieka homr, peržiūrą
Verovio, o .mscz / PDF failus sukuria MuseScore.
"""

from __future__ import annotations

import base64
import glob
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

FROZEN = getattr(sys, "frozen", False)  # paleista kaip NatuSkeneris.exe
if FROZEN:
    APP_DIR = Path(getattr(sys, "_MEIPASS", Path(sys.executable).parent))
    ROOT_DIR = Path(os.environ.get("LOCALAPPDATA") or Path.home()) / "NatuSkeneris"
else:
    APP_DIR = Path(__file__).resolve().parent
    ROOT_DIR = APP_DIR.parent
ROOT_DIR.mkdir(parents=True, exist_ok=True)
WEB_DIR = APP_DIR / "web"
WORK_DIR = ROOT_DIR / "darbai"
SETTINGS_FILE = ROOT_DIR / "nustatymai.json"
OUTPUT_DIR = Path.home() / "Documents" / "NatuSkeneris"
IS_WINDOWS = os.name == "nt"
NO_WINDOW = 0x08000000 if IS_WINDOWS else 0  # CREATE_NO_WINDOW

JOBS: dict[str, dict] = {}
LAST_PING = time.time()
# Slaptas raktas: tik mūsų langas jį žino, todėl kitos svetainės negali kreiptis į API.
TOKEN = uuid.uuid4().hex
PORT = 0


# ---------------------------------------------------------------- nustatymai


def load_settings() -> dict:
    try:
        return json.loads(SETTINGS_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_settings(data: dict) -> None:
    SETTINGS_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")


def find_musescore() -> str | None:
    custom = load_settings().get("musescore_path")
    if custom and Path(custom).is_file():
        return custom
    candidates: list[str] = []
    if IS_WINDOWS:
        for base in filter(None, [os.environ.get("ProgramFiles"),
                                  os.environ.get("ProgramFiles(x86)"),
                                  os.environ.get("LOCALAPPDATA") and
                                  os.path.join(os.environ["LOCALAPPDATA"], "Programs")]):
            candidates += sorted(glob.glob(os.path.join(base, "MuseScore*", "bin", "MuseScore*.exe")),
                                 reverse=True)
    for name in ("MuseScore4", "mscore4portable", "mscore", "musescore", "MuseScore"):
        found = shutil.which(name)
        if found:
            candidates.append(found)
    return candidates[0] if candidates else None


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
    return proc.wait()


# ---------------------------------------------------------------- atpažinimas


def log(job: dict, text: str) -> None:
    job["log"].append(text)
    job["log"] = job["log"][-200:]


def friendly_progress(line: str) -> str | None:
    low = line.lower()
    if "downloading" in low:
        return "Parsisiunčiami atpažinimo modeliai (tik pirmą kartą)…"
    if "processing" in low or "=====" in line:
        return "Atpažįstamas puslapis…"
    if "finished" in low:
        return "Puslapis atpažintas."
    if "merging" in low:
        return "Puslapiai sujungiami…"
    return None


def run_job(job_id: str, files: list[str], flatten: bool) -> None:
    job = JOBS[job_id]
    job_dir = WORK_DIR / job_id
    try:
        if not engine_ready():
            raise RuntimeError("Atpažinimo variklis neįdiegtas. Paleisk Idiegti.bat iš naujo.")
        job["stage"] = "Ruošiamos nuotraukos…"
        inputs: list[str] = []
        for name in files:
            src = job_dir / "ikelta" / name
            if src.suffix.lower() == ".pdf":
                dst = job_dir / src.name
                shutil.copy(src, dst)
                inputs.append(str(dst))
            elif src.suffix.lower() in IMAGE_EXTS:
                out, note = prepare_image(src, job_dir, flatten=flatten)
                if note:
                    log(job, f"{src.name}: {note}")
                inputs.append(str(out))
            else:
                raise RuntimeError(f"Nepalaikomas failo tipas: {src.name}")

        job["stage"] = "Atpažįstamos natos… (gali užtrukti kelias minutes)"
        def on_line(line: str) -> None:
            log(job, line)
            nice = friendly_progress(line)
            if nice:
                job["stage"] = nice

        code = run_homr_process(inputs, job_dir, on_line=on_line,
                                should_stop=lambda: job.get("cancelled", False),
                                on_start=lambda p: job.__setitem__("proc", p))
        if job.get("cancelled"):
            raise RuntimeError("Atšaukta.")
        results = sorted(job_dir.glob("*.musicxml"), key=lambda p: p.stat().st_mtime)
        if code != 0 or not results:
            raise RuntimeError("Natų atpažinti nepavyko. Pabandyk ryškesnę, tiesiau "
                               "nufotografuotą nuotrauką.")
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
        job["saved"] = [str(saved)]

        if find_musescore():
            job["stage"] = "Kuriamas MuseScore failas…"
            try:
                mscz = convert(job, "mscz")
                saved_mscz = unique_path(OUTPUT_DIR / f"{base}.mscz")
                shutil.copy(mscz, saved_mscz)
                job["saved"].append(str(saved_mscz))
            except Exception as exc:
                log(job, f"MuseScore konvertavimas nepavyko: {exc}")

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


def convert(job: dict, fmt: str) -> Path:
    """Konvertuoja MusicXML į mscz / pdf / mid per MuseScore."""
    src = Path(job["musicxml"])
    out = src.with_suffix("." + fmt)
    if out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
        return out
    exe = find_musescore()
    if not exe:
        raise RuntimeError("MuseScore nerastas. Įsidiek MuseScore 4 iš musescore.org.")
    res = subprocess.run([exe, "-o", str(out), str(src)], capture_output=True, text=True,
                         timeout=180, creationflags=NO_WINDOW)
    if not out.exists():
        raise RuntimeError("MuseScore nesukūrė failo. " + (res.stderr or "")[-300:])
    return out


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


def open_in_musescore(job: dict) -> None:
    exe = find_musescore()
    if not exe:
        raise RuntimeError("MuseScore nerastas.")
    existing = [p for p in job.get("saved", []) if p.endswith(".mscz")]
    if existing:
        target = Path(existing[0])
    else:
        try:
            target = unique_path(OUTPUT_DIR / f"{job['name']}.mscz")
            shutil.copy(convert(job, "mscz"), target)
            job.setdefault("saved", []).append(str(target))
        except Exception:
            target = Path(job["saved"][0])  # MusicXML MuseScore atsidarys ir pats
    subprocess.Popen([exe, str(target)])


def open_folder(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)
    if IS_WINDOWS:
        os.startfile(str(path))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", str(path)])
    else:
        subprocess.Popen(["xdg-open", str(path)])


# ---------------------------------------------------------------- serveris


class Handler(BaseHTTPRequestHandler):
    server_version = "NatuSkeneris/1.0"

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
                ms = find_musescore()
                return self.send_json({"musescore": ms, "engine": engine_ready(),
                                       "output_dir": str(OUTPUT_DIR)})
            if len(parts) == 3 and parts[:2] == ["api", "job"]:
                job = self.job(parts[2])
                if not job:
                    return self.send_json({"error": "nėra"}, 404)
                return self.send_json({k: job.get(k) for k in
                                       ("status", "stage", "error", "saved", "name")} |
                                      {"log": job["log"][-15:]})
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "preview":
                job = self.job(parts[2])
                return self.send_json(preview(job))
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "download":
                job = self.job(parts[2])
                fmt = parse_qs(url.query).get("fmt", ["musicxml"])[0]
                if fmt == "musicxml":
                    path = Path(job["musicxml"])
                elif fmt in ("mscz", "pdf", "mid"):
                    path = convert(job, fmt)
                else:
                    return self.send_json({"error": "blogas formatas"}, 400)
                ctype = {"musicxml": "application/vnd.recordare.musicxml+xml",
                         "mscz": "application/octet-stream", "pdf": "application/pdf",
                         "mid": "audio/midi"}[fmt]
                return self.send_file(path, ctype, f"{job['name']}.{fmt}")
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
            if len(parts) == 4 and parts[:2] == ["api", "job"] and parts[3] == "musescore":
                open_in_musescore(self.job(parts[2]))
                return self.send_json({"ok": True})
            if parts == ["api", "open-folder"]:
                open_folder(OUTPUT_DIR)
                return self.send_json({"ok": True})
            if parts == ["api", "settings"]:
                body = self.read_json()
                settings = load_settings()
                path = (body.get("musescore_path") or "").strip().strip('"')
                if path and not Path(path).is_file():
                    return self.send_json({"error": "Toks failas nerastas."}, 400)
                settings["musescore_path"] = path
                save_settings(settings)
                return self.send_json({"musescore": find_musescore()})
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
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    # Exe be konsolės neturi stdout, todėl ataskaita rašoma į failą.
    sys.stdout = sys.stderr = open(out / "selftest.log", "w", encoding="utf-8", buffering=1)  # noqa: SIM115
    src = Path(image)
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
    print("Natų skeneris veikia:", url)
    LAST_PING = time.time() + 60  # laikas langui atsidaryti
    threading.Thread(target=watchdog, args=(server,), daemon=True).start()
    if "--no-window" not in sys.argv:
        open_window(url)
    server.serve_forever()


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    main()
