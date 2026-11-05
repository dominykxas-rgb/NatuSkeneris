# Natų skenerio diegimas (Windows 10/11)
# Paleisk per Idiegti.bat

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $Root

# homr variklio versija (GitHub commit), kad diegimas visada būtų toks pat
$HomrCommit = (Get-Content (Join-Path $Root "homr-version.txt")).Trim()

function Step($text) { Write-Host ""; Write-Host "==> $text" -ForegroundColor Cyan }
function Fail($text) { Write-Host ""; Write-Host "KLAIDA: $text" -ForegroundColor Red; exit 1 }

# ------------------------------------------------------------------ 1. Python
Step "Ieškomas Python 3.11-3.13"

function Find-Python {
    foreach ($v in @("3.12", "3.13", "3.11")) {
        try {
            $exe = & py "-$v" -c "import sys; print(sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $exe) { return $exe.Trim() }
        } catch {}
    }
    foreach ($name in @("python", "python3")) {
        try {
            $out = & $name -c "import sys; print(sys.version_info[0]*100+sys.version_info[1], sys.executable)" 2>$null
            if ($LASTEXITCODE -eq 0 -and $out) {
                $parts = $out.Trim().Split(" ", 2)
                if ([int]$parts[0] -ge 311 -and [int]$parts[0] -le 313) { return $parts[1] }
            }
        } catch {}
    }
    return $null
}

$Python = Find-Python
if (-not $Python) {
    Write-Host "Tinkamas Python nerastas. Bandau įdiegti Python 3.12 per winget..."
    try {
        winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
    } catch {
        Fail "Nepavyko įdiegti Python. Atsisiųsk Python 3.12 iš https://www.python.org/downloads/ (pažymėk 'Add python.exe to PATH') ir paleisk Idiegti.bat iš naujo."
    }
    $env:Path = [Environment]::GetEnvironmentVariable("Path", "User") + ";" + [Environment]::GetEnvironmentVariable("Path", "Machine")
    $Python = Find-Python
    if (-not $Python) {
        $guess = Join-Path $env:LOCALAPPDATA "Programs\Python\Python312\python.exe"
        if (Test-Path $guess) { $Python = $guess }
    }
    if (-not $Python) { Fail "Python įdiegtas, bet nerastas. Uždaryk šį langą ir paleisk Idiegti.bat dar kartą." }
}
Write-Host "Naudojamas: $Python"

# ------------------------------------------------------------------ 2. Aplinka ir paketai
Step "Kuriama atskira Python aplinka (.venv)"
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    & $Python -m venv .venv
    if ($LASTEXITCODE -ne 0) { Fail "Nepavyko sukurti .venv aplinkos." }
}
$VPy = Join-Path $Root ".venv\Scripts\python.exe"
$VPyw = Join-Path $Root ".venv\Scripts\pythonw.exe"

Step "Diegiami reikalingi paketai (gali užtrukti kelias minutes)"
& $VPy -m pip install --upgrade pip --quiet
& $VPy -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { Fail "Nepavyko įdiegti paketų. Patikrink interneto ryšį ir bandyk dar kartą." }

# ------------------------------------------------------------------ 3. homr variklis
Step "Atsisiunčiamas homr atpažinimo variklis (atviro kodo, AGPL-3.0)"
$EngineDir = Join-Path $Root "engine"
if (-not (Test-Path (Join-Path $EngineDir "homr\main.py"))) {
    $Zip = Join-Path $env:TEMP "homr-$HomrCommit.zip"
    $Tmp = Join-Path $env:TEMP "homr-$HomrCommit"
    Invoke-WebRequest "https://github.com/liebharc/homr/archive/$HomrCommit.zip" -OutFile $Zip
    if (Test-Path $Tmp) { Remove-Item $Tmp -Recurse -Force }
    Expand-Archive $Zip -DestinationPath $Tmp
    $Src = Get-ChildItem $Tmp -Directory | Select-Object -First 1
    New-Item -ItemType Directory -Force $EngineDir | Out-Null
    Copy-Item (Join-Path $Src.FullName "homr") $EngineDir -Recurse -Force
    Copy-Item (Join-Path $Src.FullName "LICENSE") (Join-Path $EngineDir "homr-LICENSE.txt") -Force
    Remove-Item $Zip, $Tmp -Recurse -Force -ErrorAction SilentlyContinue
}

Step "Atsisiunčiami atpažinimo modeliai (~vieną kartą)"
& $VPy (Join-Path $Root "app\run_homr.py") --init --no-title
if ($LASTEXITCODE -ne 0) { Fail "Nepavyko atsisiųsti modelių. Patikrink interneto ryšį ir bandyk dar kartą." }

# ------------------------------------------------------------------ 4. Nuoroda darbalaukyje
Step "Kuriama nuoroda darbalaukyje"
& $VPy (Join-Path $Root "app\make_icon.py") | Out-Null
$Desktop = [Environment]::GetFolderPath("Desktop")
$Shell = New-Object -ComObject WScript.Shell
$Lnk = $Shell.CreateShortcut((Join-Path $Desktop "Natų skeneris.lnk"))
$Lnk.TargetPath = $VPyw
$Lnk.Arguments = "`"$(Join-Path $Root 'app\natu_skeneris.py')`""
$Lnk.WorkingDirectory = Join-Path $Root "app"
$Lnk.IconLocation = Join-Path $Root "app\icon.ico"
$Lnk.Description = "Natų nuotraukas ir PDF paverčia elektroninėmis natomis"
$Lnk.Save()

# ------------------------------------------------------------------ 5. MuseScore
Step "Tikrinama, ar įdiegtas MuseScore"
$Ms = Get-ChildItem "$env:ProgramFiles\MuseScore*\bin\MuseScore*.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($Ms) {
    Write-Host "Rastas: $($Ms.FullName)"
} else {
    Write-Host "MuseScore nerastas. Jis reikalingas .mscz failams ir natų taisymui." -ForegroundColor Yellow
    $ans = Read-Host "Atidaryti MuseScore atsisiuntimo puslapį? (T/N)"
    if ($ans -match "^[TtYy]") { Start-Process "https://musescore.org/download" }
}

Write-Host ""
Write-Host "Viskas paruošta! Darbalaukyje atsirado nuoroda 'Natų skeneris'." -ForegroundColor Green
