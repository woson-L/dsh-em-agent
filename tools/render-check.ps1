# ---------------------------------------------------------------------------
#  render-check.ps1  --  ASCII ONLY ON PURPOSE
#
#  Renders the panel route in headless Chrome and FAILS on a blank page.
#  This is the "eighth gate" that used to live inside build/deploy.ps1; that
#  script deployed a copy into <dsh-web-frontend>/dist/ -- a location DSH
#  replaces wholesale on upgrade. Static deployment is retired, so the check
#  now points at the LIVE plugin route instead of a copied file.
#
#  Why this exists:
#    A structurally valid build can still render an empty shell -- a missing
#    </style> produced exactly that once. Tag pairing and node --check cannot
#    see it; only pixels can.
#
#  Portability:
#    No absolute paths anywhere. Chrome/Edge is discovered from the -Chrome
#    parameter, then $env:CHROME_PATH, then the usual per-user and per-machine
#    install roots read from the environment, then PATH. Every path is derived
#    at run time, so a checkout works on someone else's machine unchanged.
#
#  Exit codes:
#    0  both renders look like a real page
#    1  a render looks blank (or a screenshot is missing)
#    2  skipped: no browser found, or System.Drawing is unavailable
#    3  the URL did not answer (is `dsh web` running?)
#
#  Usage:
#    powershell -NoProfile -ExecutionPolicy Bypass -File tools\render-check.ps1
#    pwsh -File tools/render-check.ps1 -Url http://127.0.0.1:8080/em-agent
#    pwsh -File tools/render-check.ps1 -OutDir <dir> -WaitMs 5000
#
#  Note on the dark shot: the light shot is taken over http against the real
#  route. The dark shot needs prefers-color-scheme forced, which is done by
#  rewriting the media query in a temp copy and rendering it over file://.
#  That copy is CSS-only: the panel's markup is fully static, so it renders
#  without the page's scripts. It checks colour/layout, not runtime behaviour.
# ---------------------------------------------------------------------------
param(
    [string] $Url        = 'http://127.0.0.1:3080/em-agent',
    [string] $OutDir     = '',
    [string] $Chrome     = '',
    [int]    $ViewportW  = 1600,
    [int]    $ViewportH  = 1080,
    [int]    $WaitMs     = 3500,
    [double] $MinEdgePct = 0.5,
    [int]    $MinMaxGrad = 60,
    [switch] $LightOnly
)

$ErrorActionPreference = 'Stop'

$RepoRoot = Split-Path $PSScriptRoot -Parent
if (-not $OutDir) { $OutDir = Join-Path $RepoRoot 'dist\shots' }
if (-not (Test-Path $OutDir)) { New-Item -ItemType Directory -Force -Path $OutDir | Out-Null }

function Write-Line { param([string] $Text) Write-Output $Text }

# --- 1. locate a Chromium-family browser, without hardcoding any path ------
function Resolve-Browser {
    param([string] $Explicit)

    $roots = @()
    foreach ($v in @('ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA', 'ProgramW6432')) {
        $p = [Environment]::GetEnvironmentVariable($v)
        if ($p -and (Test-Path $p)) { $roots += $p }
    }
    $relatives = @(
        'Google\Chrome\Application\chrome.exe',
        'Microsoft\Edge\Application\msedge.exe',
        'Chromium\Application\chrome.exe'
    )

    $candidates = @()
    if ($Explicit) { $candidates += $Explicit }
    if ($env:CHROME_PATH) { $candidates += $env:CHROME_PATH }
    foreach ($r in $roots) { foreach ($rel in $relatives) { $candidates += (Join-Path $r $rel) } }
    foreach ($name in @('chrome.exe', 'msedge.exe', 'chrome')) {
        $cmd = Get-Command $name -ErrorAction SilentlyContinue
        if ($cmd -and $cmd.Source) { $candidates += $cmd.Source }
    }

    foreach ($c in $candidates) {
        if ($c -and (Test-Path -LiteralPath $c)) { return $c }
    }
    return $null
}

$Browser = Resolve-Browser -Explicit $Chrome
if (-not $Browser) {
    Write-Line 'SKIP: no Chrome/Edge found.'
    Write-Line '      Pass -Chrome <path>, or set CHROME_PATH, to point at one.'
    exit 2
}
Write-Line "browser: $Browser"

try { Add-Type -AssemblyName System.Drawing -ErrorAction Stop }
catch {
    Write-Line 'SKIP: System.Drawing is unavailable, cannot analyse pixels.'
    exit 2
}

# --- 2. is the route answering? -------------------------------------------
$status = 0
try {
    $probe = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 15
    $status = [int] $probe.StatusCode
    $panelHtml = $probe.Content
} catch {
    if ($_.Exception.Response) { $status = [int] $_.Exception.Response.StatusCode.value__ }
}
if ($status -ne 200) {
    Write-Line "FAIL: $Url -> HTTP $status"
    Write-Line '      Is `dsh web` running, and is the plugin row mounted?'
    Write-Line '      dsh --profile web --dump-config | Select-String em-agent-panel'
    exit 3
}
Write-Line "route : $Url -> HTTP 200 ($($panelHtml.Length) chars)"

$UserDataDir = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-render-check'
if (Test-Path $UserDataDir) { Remove-Item $UserDataDir -Recurse -Force -ErrorAction SilentlyContinue }

function Invoke-Shot {
    param([string] $Target, [string] $OutFile)
    if (Test-Path $OutFile) { Remove-Item $OutFile -Force }
    # Chromium writes progress lines to stderr and may exit non-zero even when
    # the screenshot succeeded, so a Stop preference here would abort the run
    # on success. The PNG on disk is the only reliable proof.
    $prev = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    try {
        & $Browser --headless=new --disable-gpu --hide-scrollbars --no-first-run `
            --no-default-browser-check --force-device-scale-factor=1 `
            --virtual-time-budget=$WaitMs --user-data-dir=$UserDataDir `
            --window-size=$ViewportW,$ViewportH --screenshot=$OutFile $Target 2>$null | Out-Null
    } catch {
        # Browser startup noise is not a result; measured below.
    } finally {
        $ErrorActionPreference = $prev
    }
    return (Test-Path $OutFile)
}

# --- 3. measure "is this a real page or an empty shell" -------------------
function Measure-Shot {
    param([string] $Path)

    $bmp = [System.Drawing.Bitmap]::FromFile($Path)
    try {
        $bw = $bmp.Width
        $bh = $bmp.Height
        $rect = New-Object System.Drawing.Rectangle(0, 0, $bw, $bh)
        $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly,
                              [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
        try {
            $stride = $data.Stride
            $buf = New-Object byte[] ($stride * $bh)
            [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
        } finally { $bmp.UnlockBits($data) }
    } finally { $bmp.Dispose() }

    $maxGrad = 0
    $edge = 0
    $n = 0
    for ($y = 0; $y -lt $bh; $y += 3) {
        $row = $y * $stride
        for ($x = 1; $x -lt $bw; $x += 3) {
            $i = $row + $x * 4
            $j = $i - 4
            $d = [Math]::Abs($buf[$i + 2] - $buf[$j + 2]) +
                 [Math]::Abs($buf[$i + 1] - $buf[$j + 1]) +
                 [Math]::Abs($buf[$i] - $buf[$j])
            if ($d -gt $maxGrad) { $maxGrad = $d }
            if ($d -gt 24) { $edge++ }
            $n++
        }
    }
    return [pscustomobject]@{
        Width   = $bw
        Height  = $bh
        MaxGrad = $maxGrad
        EdgePct = if ($n -gt 0) { [Math]::Round(100.0 * $edge / $n, 3) } else { 0 }
    }
}

$failures = @()
$shots = @()
$shots += [pscustomobject]@{ Name = 'light'; Path = (Join-Path $OutDir 'shot-light.png') }

# --- 4. dark copy: force prefers-color-scheme by rewriting the query ------
$darkTemp = $null
if (-not $LightOnly) {
    $darkTemp = Join-Path ([System.IO.Path]::GetTempPath()) 'dsh-render-check-dark.html'
    try {
        $marker = '@media (prefers-color-scheme: dark) {'
        if ($panelHtml.Contains($marker)) {
            $darkHtml = $panelHtml.Replace($marker, '@media all {')
            [System.IO.File]::WriteAllText($darkTemp, $darkHtml, (New-Object System.Text.UTF8Encoding($false)))
            $darkUri = (New-Object System.Uri($darkTemp)).AbsoluteUri
            $shots += [pscustomobject]@{ Name = 'dark'; Path = (Join-Path $OutDir 'shot-dark.png'); Target = $darkUri }
        } else {
            Write-Line 'NOTE: dark media query not found in the panel -- dark shot skipped.'
            $darkTemp = $null
        }
    } catch {
        Write-Line "NOTE: dark copy failed ($($_.Exception.Message)) -- dark shot skipped."
        $darkTemp = $null
    }
}

# --- 5. render + judge -----------------------------------------------------
try {
    foreach ($s in $shots) {
        $target = if ($s.Target) { $s.Target } else { $Url }
        if (-not (Invoke-Shot -Target $target -OutFile $s.Path)) {
            $failures += "$($s.Name): screenshot missing"
            continue
        }
        $m = Measure-Shot -Path $s.Path
        $ok = ($m.MaxGrad -gt $MinMaxGrad) -and ($m.EdgePct -gt $MinEdgePct)
        if (-not $ok) { $failures += "$($s.Name): looks blank (maxGrad=$($m.MaxGrad), edge%=$($m.EdgePct))" }
        Write-Line ("  {0,-5} {1}x{2}  maxGrad={3,-5} edge={4,-7}% {5}" -f `
            $s.Name, $m.Width, $m.Height, $m.MaxGrad, $m.EdgePct, $(if ($ok) { 'OK' } else { 'BLANK' }))
    }
} finally {
    if ($darkTemp -and (Test-Path $darkTemp)) { Remove-Item $darkTemp -Force -ErrorAction SilentlyContinue }
    if (Test-Path $UserDataDir) { Remove-Item $UserDataDir -Recurse -Force -ErrorAction SilentlyContinue }
}

Write-Line "shots : $OutDir"
if ($failures.Count -gt 0) {
    Write-Line ("FAIL: " + ($failures -join '; '))
    exit 1
}
Write-Line 'PASS: render looks like a real page'
exit 0
