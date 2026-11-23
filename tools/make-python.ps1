# make-python.ps1: the Python the desktop app bundles (resources/bridge/python), so the zip needs no Python on the PC.
#   The official Python embeddable package for Windows x64 (checked against python.org's published MD5), plus numpy,
#   Pillow and mcp as binary wheels for cp312 win_amd64 in Lib\site-packages. Then:
#   npm run app:dist -- --bridge <dc-qalink checkout> --bridge-ref <commit> --python <Out>\python
# Usage: powershell -File tools/make-python.ps1 -Out <empty build folder> [-Pip <a Python 3.12 with pip>]
#   -Pip is only used to download and unpack wheels (pip download / install --target for win_amd64); it is not bundled.
param(
  [Parameter(Mandatory = $true)][string]$Out,
  [string]$Pip = 'python'
)
$ErrorActionPreference = 'Stop'
$ver = '3.12.10'
$md5 = 'fe8ef205f2e9c3ba44d0cf9954e1abd3'   # python.org, Python 3.12.10 release page: Windows embeddable package (64-bit)
$pkgs = @('numpy==2.5.5', 'pillow==13.0.0', 'mcp==2.3.0')
$plat = @('--only-binary=:all:', '--platform', 'win_amd64', '--python-version', '3.12', '--implementation', 'cp', '--abi', 'cp312')

New-Item -ItemType Directory -Force $Out | Out-Null
$zip = Join-Path $Out "python-$ver-embed-amd64.zip"
if (-not (Test-Path $zip)) {
  Invoke-WebRequest -UseBasicParsing -Uri "https://www.python.org/ftp/python/$ver/python-$ver-embed-amd64.zip" -OutFile $zip
}
if ((Get-FileHash -Algorithm MD5 $zip).Hash.ToLower() -ne $md5) { throw "$zip does not match python.org's MD5 $md5" }

$py = Join-Path $Out 'python'
if (Test-Path $py) { Remove-Item -Recurse -Force $py }
Expand-Archive -Path $zip -DestinationPath $py
# python312._pth: the standard library zip, the folder, and `import site`, which adds <prefix>\Lib\site-packages and
# runs its .pth files (pywin32, which mcp uses on Windows, needs them). The bridge runs with -I, so no user site and no
# PYTHON* environment variables reach it.
[IO.File]::WriteAllText((Join-Path $py 'python312._pth'), "python312.zip`r`n.`r`nimport site`r`n")

$sp = Join-Path $py 'Lib\site-packages'
$wh = Join-Path $Out 'wheels'
if (Test-Path $wh) { Remove-Item -Recurse -Force $wh }
New-Item -ItemType Directory -Force $sp, $wh | Out-Null
& $Pip -m pip download --disable-pip-version-check @plat -d $wh @pkgs
if ($LASTEXITCODE -ne 0) { throw 'pip download failed' }
& $Pip -m pip install --disable-pip-version-check --no-index --find-links $wh @plat --no-compile --target $sp @pkgs
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }

# not used by the bridge: console scripts, caches, numpy's own test suites, pywin32's GUI editor
Remove-Item -Recurse -Force (Join-Path $sp 'bin') -ErrorAction SilentlyContinue
Get-ChildItem $sp -Recurse -Directory -Filter __pycache__ | Remove-Item -Recurse -Force
Get-ChildItem (Join-Path $sp 'numpy') -Recurse -Directory | Where-Object { $_.Name -eq 'tests' } | Remove-Item -Recurse -Force
Remove-Item -Recurse -Force (Join-Path $sp 'pythonwin') -ErrorAction SilentlyContinue

& (Join-Path $py 'python.exe') -I -c "import sys, numpy, mcp; from PIL import Image; print('Python', sys.version.split()[0], 'numpy', numpy.__version__, 'Pillow', Image.__version__, 'mcp: imports')"
if ($LASTEXITCODE -ne 0) { throw 'the bundled Python does not import numpy, Pillow and mcp' }
$n = Get-ChildItem $py -Recurse -File | Measure-Object -Sum Length
"$py : $($n.Count) files, $([math]::Round($n.Sum / 1MB, 1)) MB"
