# ============================================================================
#  deploy.ps1 —— 构建 → 部署到 DSH Web 静态目录 → 渲染校验
#
#  用法：
#    pwsh -File build/deploy.ps1                        # 自动探测 DSH 静态目录
#    pwsh -File build/deploy.ps1 -Target "D:\path\to\dist"
#
#  为什么需要这一步：页面必须由 DSH Web 服务同源提供（http(s)）才能调用
#  MCP；直接双击以 file:// 打开会降级为「复制指令」模式。
#
#  ⚠️ 部署不随 DSH 升级保留：<dsh-web-frontend>/dist/ 是 DSH 的安装目录，
#     升级或重装时会被整体替换，放进去的页面会全部消失（表现为 URL 突然 404）。
#     升级后重新执行本脚本即可恢复；仓库里的 dist/ 与 src/ 才是可信来源。
# ============================================================================
param(
  [string]$Target = "",
  [string]$RepoRoot = "",
  [string]$As = "",
  [switch]$Force,
  [string]$Chrome = "C:\Program Files\Google\Chrome\Application\chrome.exe",
  [int]$Port = 3080
)

$ErrorActionPreference = 'Stop'
if (-not $RepoRoot) {
  if ($PSScriptRoot) { $RepoRoot = Split-Path $PSScriptRoot -Parent }
  else { throw "无法确定仓库根目录，请用 -RepoRoot 显式指定" }
}

# --- 1. 构建（内部有硬门禁） ---
& ([scriptblock]::Create([System.IO.File]::ReadAllText((Join-Path $RepoRoot "build\build.ps1")))) -RepoRoot $RepoRoot

$Dist = Join-Path $RepoRoot "dist\antenna-optimizer-panel.html"
if (-not (Test-Path $Dist)) { throw "构建产物不存在: $Dist" }

# --- 2. 定位 DSH Web 静态目录 ---
if (-not $Target) {
  $candidates = @(
    (Join-Path $env:APPDATA "npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-web-frontend\dist")
  )
  # 同时扫描常见的离线安装位置
  foreach ($root in @("C:\", "D:\", "E:\")) {
    if (Test-Path $root) {
      Get-ChildItem $root -Filter "dsh-web-frontend" -Recurse -Directory -Force -ErrorAction SilentlyContinue |
        ForEach-Object { $candidates += (Join-Path $_.FullName "dist") }
    }
  }
  $Target = ($candidates | Where-Object { $_ -and (Test-Path (Join-Path $_ "index.html")) } | Select-Object -First 1)
}
if (-not $Target -or -not (Test-Path $Target)) {
  throw "未找到 DSH Web 静态目录。请用 -Target 显式指定（其中应含 index.html）"
}
Write-Output "目标静态目录: $Target"

# --- 3. 部署（只新增/更新本插件自己的文件，不动任何其它文件） ---
$name = if ($As) { $As } else { Split-Path $Dist -Leaf }
$dest = Join-Path $Target $name
# 安全护栏：目标已存在且内容不同时，先确认是不是本插件的旧版，避免误覆盖别人的文件
if ((Test-Path $dest) -and -not $Force) {
  $same = (Get-FileHash $dest -Algorithm SHA256).Hash -eq (Get-FileHash $Dist -Algorithm SHA256).Hash
  $looksOurs = (Select-String -Path $dest -Pattern "AI 全流程板载天线设计" -Quiet -ErrorAction SilentlyContinue)
  if (-not $same -and -not $looksOurs) {
    throw "目标已存在且看起来不是本插件的文件: $dest`n如确认要覆盖，请加 -Force"
  }
}
$origPath = Join-Path $Target "antenna-optimizer-config-panel.original.html"
$origBefore = if (Test-Path $origPath) { (Get-FileHash $origPath -Algorithm SHA256).Hash } else { "" }
Copy-Item -LiteralPath $Dist -Destination $dest -Force
Write-Output "已部署: $dest ($((Get-Item $dest).Length) 字节)"

# --- 4. 可选：渲染校验（需要 Chrome） ---
if (Test-Path $Chrome) {
  $enc = New-Object System.Text.UTF8Encoding($false)
  # 深色预览副本：把 prefers-color-scheme 媒体查询改为无条件生效
  $dark = Join-Path $Target "_dark-preview.html"
  $t = [System.IO.File]::ReadAllText($Dist, $enc)
  [System.IO.File]::WriteAllText($dark, $t.Replace("@media (prefers-color-scheme: dark) {", "@media all {"), $enc)

  Start-Sleep -Milliseconds 400
  foreach ($n in @($name, "_dark-preview.html")) {
    try {
      $r = Invoke-WebRequest -Uri "http://127.0.0.1:$Port/$n" -UseBasicParsing -TimeoutSec 10
      Write-Output ("  GET /{0,-46} HTTP {1}  {2} 字节" -f $n, $r.StatusCode, $r.RawContentLength)
    } catch { Write-Output ("  GET /{0,-46} 失败: {1}" -f $n, $_.Exception.Message) }
  }

  $shotsDir = Join-Path $RepoRoot "dist\shots"
  if (-not (Test-Path $shotsDir)) { New-Item -ItemType Directory -Force -Path $shotsDir | Out-Null }
  $ud = Join-Path $env:TEMP "dsh-antenna-shot"
  $shots = @(
    @{ n = "light"; u = "http://127.0.0.1:$Port/$name";              w = 1600; h = 1080 },
    @{ n = "dark";  u = "http://127.0.0.1:$Port/_dark-preview.html"; w = 1600; h = 1080 }
  )
  $ErrorActionPreference = 'Continue'
  foreach ($s in $shots) {
    $png = Join-Path $shotsDir ("shot-" + $s.n + ".png")
    if (Test-Path $png) { Remove-Item $png -Force }
    & $Chrome --headless=new --disable-gpu --hide-scrollbars --no-first-run --no-default-browser-check `
      --force-device-scale-factor=1 --virtual-time-budget=3500 --user-data-dir=$ud `
      --window-size=$($s.w),$($s.h) --screenshot=$png $s.u 2>&1 | Out-Null
  }
  $ErrorActionPreference = 'Stop'

  # 空白页检测：空白页 maxGrad≈2 / edge≈0，真实渲染 maxGrad≈530 / edge≈3.5-4
  Add-Type -AssemblyName System.Drawing
  $fail = @()
  foreach ($s in $shots) {
    $png = Join-Path $shotsDir ("shot-" + $s.n + ".png")
    if (-not (Test-Path $png)) { $fail += "$($s.n): 截图缺失"; continue }
    $bmp = [System.Drawing.Bitmap]::FromFile($png)
    $bw = $bmp.Width; $bh = $bmp.Height        # 必须在 Dispose 之前取出
    $rect = New-Object System.Drawing.Rectangle(0, 0, $bw, $bh)
    $data = $bmp.LockBits($rect, [System.Drawing.Imaging.ImageLockMode]::ReadOnly, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    $stride = $data.Stride; $buf = New-Object byte[] ($stride * $bh)
    [System.Runtime.InteropServices.Marshal]::Copy($data.Scan0, $buf, 0, $buf.Length)
    $bmp.UnlockBits($data); $bmp.Dispose()
    $maxGrad = 0; $edge = 0; $n = 0
    for ($y = 0; $y -lt $bh; $y += 3) {
      $row = $y * $stride
      for ($x = 1; $x -lt $bw; $x += 3) {
        $i = $row + $x * 4; $j = $i - 4
        $d = [Math]::Abs($buf[$i+2] - $buf[$j+2]) + [Math]::Abs($buf[$i+1] - $buf[$j+1]) + [Math]::Abs($buf[$i] - $buf[$j])
        if ($d -gt $maxGrad) { $maxGrad = $d }
        if ($d -gt 24) { $edge++ }
        $n++
      }
    }
    $pct = [Math]::Round(100.0 * $edge / $n, 3)
    $ok = ($maxGrad -gt 60) -and ($pct -gt 0.5)
    if (-not $ok) { $fail += "$($s.n): 疑似空白页 (maxGrad=$maxGrad, edge%=$pct)" }
    Write-Output ("  截图 {0,-6} 最大梯度={1,-5} 边缘={2,-7}% {3}" -f $s.n, $maxGrad, $pct, $(if ($ok) { 'OK' } else { '空白' }))
  }
  Remove-Item -LiteralPath $dark -Force -ErrorAction SilentlyContinue
  if ($fail.Count -gt 0) { throw ("渲染校验未通过: " + ($fail -join '; ')) }
  Write-Output "渲染校验: 通过 OK"
} else {
  Write-Output "未找到 Chrome，跳过渲染校验（构建产物本身已通过全部门禁）"
}

# --- 5. 确认未改动原有文件 ---
if ($origBefore) {
  $origAfter = (Get-FileHash $origPath -Algorithm SHA256).Hash
  Write-Output "原有页面未被改动: $(if ($origBefore -eq $origAfter) { '是 OK' } else { '否 —— 请检查' })"
}
Write-Output ""
Write-Output "部署完成。访问： http://127.0.0.1:$Port/$name"
