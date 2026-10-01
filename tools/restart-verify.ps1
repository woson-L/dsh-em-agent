# ---------------------------------------------------------------------------
#  restart-verify.ps1  --  ASCII ONLY ON PURPOSE
#
#  Restarts the DSH web service, verifies that the antenna-optimizer plugin
#  route comes back, and ROLLS BACK the profile config if it does not.
#
#  Why a script instead of doing it by hand:
#    restarting `dsh web` terminates the agent session that is asking for the
#    restart, so the restart has to happen in a process that outlives it.
#    This file is launched through WMI (Win32_Process.Create), which makes it
#    a child of WmiPrvSE rather than of DSH, so killing DSH does not kill it.
#
#  Timeline:
#     t+0s    wait DelaySeconds (lets the agent's final message reach the page)
#     t+60s   stop `dsh web`
#     t+60s   start `dsh web` again
#     +150s   poll http://127.0.0.1:3080/  until any HTTP status is returned
#     then    check /em-agent == 200, body length == ExpectBytes, and that the
#             legacy alias /antenna-optimizer still answers 200
#     FAIL    restore the pre-change profile config, restart, log ROLLBACK
#
#  Log: <Desktop>\dsh-restart-verify.log   (override with -LogFile)
# ---------------------------------------------------------------------------
param(
    [string] $DshHome               = '',          # empty = %DSH_HOME% or %USERPROFILE%\.dsh
    [string] $ProfileName           = 'web',
    [string] $RepoRoot              = '',          # empty = parent of this script
    [int]    $DelaySeconds          = 60,
    [int]    $ReadyTimeoutSeconds   = 150,
    [string] $ProfileDir            = '',          # empty = <DshHome>\profiles\<ProfileName>
    [string] $RollbackDir           = '',          # empty = skip the profile-rollback stage
    [string] $CodeBackupDir         = '',          # empty = skip the code-rollback stage
    [string] $PluginDir             = '',          # empty = <RepoRoot>\plugin
    [string] $LogFile               = '',          # empty = <Desktop>\dsh-restart-verify.log
    [string] $DshCmd                = '',          # empty = resolve dsh from PATH
    [string] $PanelUrl              = 'http://127.0.0.1:3080/em-agent',
    [string] $LegacyUrl             = 'http://127.0.0.1:3080/antenna-optimizer',
    [string] $LegacyStaticUrl       = 'http://127.0.0.1:3080/antenna-optimizer-config-panel.html',
    [string] $RootUrl               = 'http://127.0.0.1:3080/',
    [int]    $ExpectBytes           = 228087
)

# ---------------------------------------------------------------------------
#  Path resolution. Every path is derived from the environment; none is tied to
#  one machine. Pass an explicit parameter to override any of them.
# ---------------------------------------------------------------------------
if (-not $DshHome) {
    $DshHome = if ($env:DSH_HOME) { $env:DSH_HOME } else { Join-Path $HOME '.dsh' }
}
if (-not $ProfileDir) { $ProfileDir = Join-Path $DshHome ("profiles\" + $ProfileName) }
if (-not $LogFile)    { $LogFile    = Join-Path ([Environment]::GetFolderPath('Desktop')) 'dsh-restart-verify.log' }
if (-not $RepoRoot)   { $RepoRoot   = Split-Path $PSScriptRoot -Parent }
if (-not $PluginDir)  { $PluginDir  = Join-Path $RepoRoot 'plugin' }
if (-not $DshCmd) {
    $found = Get-Command dsh -ErrorAction SilentlyContinue
    if ($found) { $DshCmd = $found.Source } else { $DshCmd = '' }
}
Write-Log ('resolved DshHome={0} ProfileDir={1} LogFile={2}' -f $DshHome, $ProfileDir, $LogFile)

$ErrorActionPreference = 'Continue'
$script:Failed = $false

function Write-Log {
    param([string] $Message)
    $line = '[{0}] {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
    Add-Content -LiteralPath $LogFile -Value $line -Encoding ASCII -ErrorAction SilentlyContinue
}

function Get-DshWebProcess {
    Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
        Where-Object {
            $_.CommandLine -and
            $_.CommandLine -match 'deepseek-ai' -and
            $_.CommandLine -match 'bin\.js' -and
            $_.CommandLine -match 'web'
        }
}

# Returns the HTTP status code, or 0 when the connection failed.
function Get-Status {
    param([string] $Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 12
        return [int] $r.StatusCode
    } catch {
        if ($_.Exception.Response) { return [int] $_.Exception.Response.StatusCode.value__ }
        return 0
    }
}

function Get-BodyLength {
    param([string] $Url)
    try {
        $r = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 20
        return [int] $r.RawContentLength
    } catch {
        return -1
    }
}

function Stop-DshWeb {
    $procs = @(Get-DshWebProcess)
    if ($procs.Count -eq 0) { Write-Log 'no running dsh web process found'; return }
    foreach ($p in $procs) {
        Write-Log ('stopping dsh web PID {0}' -f $p.ProcessId)
        Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
    }
    $deadline = (Get-Date).AddSeconds(40)
    while ((Get-Date) -lt $deadline) {
        if (@(Get-DshWebProcess).Count -eq 0) { break }
        Start-Sleep -Seconds 1
    }
    Write-Log ('dsh web processes still alive: {0}' -f @(Get-DshWebProcess).Count)
}

function Start-DshWeb {
    # Same shape as the desktop launcher: a minimized console window, so that a
    # crash stays inspectable instead of vanishing with the parent process.
    if (Test-Path -LiteralPath $DshCmd) {
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', ('"{0}" web' -f $DshCmd) -WindowStyle Minimized | Out-Null
    } else {
        Start-Process -FilePath 'cmd.exe' -ArgumentList '/k', 'dsh web' -WindowStyle Minimized | Out-Null
    }
    Write-Log 'launched: dsh web'
}

function Wait-Listening {
    param([int] $TimeoutSeconds)
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    while ((Get-Date) -lt $deadline) {
        if ((Get-Status $RootUrl) -ne 0) { return $true }
        Start-Sleep -Seconds 3
    }
    return $false
}

function Invoke-Rollback {
    Write-Log '--- ROLLBACK ---'

    # 1) Restore the plugin CODE first. This is the rollback that matters for a
    #    plugin-source change: the profile row stays installed, we just go back
    #    to the previous index.js. Restoring only the profile config would
    #    uninstall the plugin entirely - far more drastic than needed.
    if (Test-Path -LiteralPath $CodeBackupDir) {
        foreach ($name in @('index.js', 'package.json')) {
            $src = Join-Path $CodeBackupDir $name
            if (Test-Path -LiteralPath $src) {
                Copy-Item -LiteralPath $src -Destination (Join-Path $PluginDir $name) -Force
                Write-Log ('restored plugin code: {0}' -f $name)
            }
        }
    } else {
        Write-Log ('code backup directory missing: {0}' -f $CodeBackupDir)
    }

    # 2) Profile config is the fallback for "DSH will not boot at all".
    if (-not (Test-Path -LiteralPath $RollbackDir)) {
        Write-Log ('rollback directory missing: {0}' -f $RollbackDir)
        return
    }
    foreach ($name in @('cordis.patch.yml', 'cordis.yml', 'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml')) {
        $src = Join-Path $RollbackDir $name
        if (Test-Path -LiteralPath $src) {
            Copy-Item -LiteralPath $src -Destination (Join-Path $ProfileDir $name) -Force
            Write-Log ('restored {0}' -f $name)
        }
    }
    Stop-DshWeb
    Start-DshWeb
    if (Wait-Listening $ReadyTimeoutSeconds) {
        Write-Log ('rollback restart listening; root HTTP {0}' -f (Get-Status $RootUrl))
    } else {
        Write-Log 'rollback restart FAILED to listen - manual attention required'
    }
}

# ===========================================================================
Write-Log '================ restart-verify started ================'
Write-Log ('delay {0}s before touching the service' -f $DelaySeconds)
Start-Sleep -Seconds $DelaySeconds

$before = @(Get-DshWebProcess)
Write-Log ('dsh web before restart: {0} process(es)' -f $before.Count)

Stop-DshWeb
Start-DshWeb

if (-not (Wait-Listening $ReadyTimeoutSeconds)) {
    Write-Log 'FAIL: dsh web did not start listening after restart'
    Invoke-Rollback
    Write-Log '================ finished (rolled back) ================'
    exit 3
}

$rootStatus = Get-Status $RootUrl
Write-Log ('root {0} -> HTTP {1}' -f $RootUrl, $rootStatus)

$panelStatus = Get-Status $PanelUrl
$panelBytes  = Get-BodyLength $PanelUrl
Write-Log ('panel {0} -> HTTP {1}, {2} bytes' -f $PanelUrl, $panelStatus, $panelBytes)

# Marker: a 405 must carry Allow. This is the current code generation marker; This is the ONLY probe that can
# tell the NEW plugin code apart from the OLD one, because the route, the byte
# count and the body are identical in both versions - a remount does not bust
# Node's module cache, so only a real restart swaps the code in.
$allow = ''
try {
    $null = Invoke-WebRequest -Uri $PanelUrl -Method POST -UseBasicParsing -TimeoutSec 10
    Write-Log 'marker: POST unexpectedly succeeded (expected 405)'
} catch {
    $h = $_.Exception.Response.Headers['Allow']
    if ($h) { $allow = $h }
    Write-Log ('marker: POST -> HTTP {0}, Allow = {1}' -f $_.Exception.Response.StatusCode.value__, $(if ($h) { $h } else { '<missing>' }))
}

if ($panelStatus -eq 200 -and $panelBytes -eq $ExpectBytes -and $allow -match 'GET') {
    Write-Log 'PASS: plugin route survived a real cold restart'
    Write-Log 'PASS: 405 carries Allow -> the NEW plugin code is loaded'
    # The plugin keeps /antenna-optimizer as a permanent compatibility alias.
    # A non-200 here is a real regression in index.js, not a flaky probe.
    $legacyStatus = Get-Status $LegacyUrl
    if ($legacyStatus -eq 200) {
        Write-Log ('PASS: legacy alias {0} -> HTTP 200' -f $LegacyUrl)
    } else {
        Write-Log ('FAIL: legacy alias {0} -> HTTP {1} (expected 200)' -f $LegacyUrl, $legacyStatus)
        Write-Log '================ finished (route OK, alias BROKEN; no rollback) ================'
        exit 6
    }

    # The static deployment was retired: the page now ships only as a plugin
    # route. A 200 here means a stale copy was re-deployed into the DSH static
    # directory - worth reporting loudly, but it must not fail this check.
    $staticStatus = Get-Status $LegacyStaticUrl
    if ($staticStatus -eq 404) {
        Write-Log ('PASS: retired static page -> HTTP 404')
    } else {
        Write-Log ('NOTE: retired static page {0} -> HTTP {1} (404 expected)' -f $LegacyStaticUrl, $staticStatus)
    }
    Write-Log '================ finished (OK) ================'
    exit 0
}

if ($panelStatus -eq 200 -and $panelBytes -eq $ExpectBytes) {
    Write-Log 'PARTIAL: route is up but 405 has no Allow -> the OLD plugin code is still loaded'
    Write-Log '================ finished (no rollback; route works) ================'
    exit 5
}

Write-Log ('FAIL: expected HTTP 200 and {0} bytes' -f $ExpectBytes)
Invoke-Rollback
Write-Log '================ finished (rolled back) ================'
exit 4
