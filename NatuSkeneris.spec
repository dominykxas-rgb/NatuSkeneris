# PyInstaller receptas: pyinstaller NatuSkeneris.spec --noconfirm
# Prieš tai: engine/homr turi būti atsiųstas, o modeliai parsisiųsti (run_homr.py --init --no-title).
# PYTHONPATH turi apimti aplankus engine ir app.

from PyInstaller.utils.hooks import collect_all

datas = [("app/web", "web")]
binaries = []
hiddenimports = ["homr_entry", "photo_prep"]

for pkg in ["homr", "rapidocr", "verovio", "pypdfium2", "pypdfium2_raw", "pillow_heif",
            "onnxruntime", "cv2"]:
    d, b, h = collect_all(pkg)
    datas += d
    binaries += b
    hiddenimports += h

a = Analysis(
    ["app/natu_skeneris.py"],
    pathex=["app", "engine"],
    datas=datas,
    binaries=binaries,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "matplotlib", "torch", "tensorflow", "IPython", "pytest"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="NatuSkeneris",
    console=False,
    icon="app/icon.ico",
    version=None,
)
coll = COLLECT(exe, a.binaries, a.datas, name="NatuSkeneris")
