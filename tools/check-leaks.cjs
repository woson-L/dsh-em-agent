#!/usr/bin/env node
/* ============================================================================
 *  check-leaks.cjs —— 提交前自检：仓库里有没有不该公开的本机信息
 *
 *  为什么需要它：这个仓库会公开分发，而「本机路径」是最容易悄悄混进来的东西 ——
 *  它常常是有用的示例（安装路径、工作区、测试夹具），写的时候完全合理，
 *  公开之后却暴露了作者的机器布局。规则靠自觉守不住，所以做成一个可执行检查。
 *
 *  用法：
 *    node tools/check-leaks.cjs              # 扫当前仓库（跳过 dist/ 与历史日志）
 *    node tools/check-leaks.cjs --all        # 连 dist/ 一起扫（发布前用这个）
 *    node tools/check-leaks.cjs <dir>        # 扫指定目录
 *
 *  退出码：0 = 干净；1 = 有命中（会逐条列出 文件:行号 + 命中内容 + 建议）
 *
 *  判定原则：
 *    - 只报「本机身份/路径/凭据」类命中，不管代码风格；
 *    - 白名单里的路径是**刻意保留的通用示例**（`C:\Program Files\…` 之类），
 *      它们与具体机器无关，属于文档惯例；改动白名单请连同 CHANGELOG 一起说明。
 * ========================================================================== */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/* 允许出现的「通用示例路径」前缀（与具体机器无关） */
const ALLOWED_PATHS = [
  'C:\\Program Files\\',        // Windows 软件默认安装位置
  'C:\\Program Files (x86)\\',
  'C:\\Python311\\',            // 测试夹具用的中性示例
  'C:\\cst_runs',               // 测试夹具用的中性示例
  'C:\\CST_Workspace',          // 本仓库示例用工作区
  'C:\\CST-MCP',                // 本仓库示例用 MCP 安装位置
  'C:\\CST_MCP_workspace',
  'C:\\dev\\',                  // 本仓库示例用开发目录
  'C:\\Users\\<',               // 占位符写法 C:\Users\<you>\
  'X:\\', 'Y:\\',               // 测试夹具里的合成路径
  'D:\\path\\to\\',             // 文档示例
];

/* 纯盘符根（`E:\` 这种）只是「探测哪些盘存在」，不含任何用户信息 */
const BARE_DRIVE = /^[A-Za-z]:\\+$/;

const SKIP_DIRS = new Set(['node_modules', '.git']);
const SKIP_REL = ['dist/shots/', 'docs/reference/history/'];
const TEXT_EXT = new Set(['.md', '.js', '.cjs', '.mjs', '.json', '.yml', '.yaml', '.ps1', '.html', '.css', '.txt', '.sh', '']);

const PII = [
  { id: 'win-abs-path', re: /[A-Za-z]:\\[^\s"'`,;)\]}]*/g,
    hint: 'Windows 绝对路径：确认不是本机路径（示例请用 C:\\ 惯用值或占位符）' },
  { id: 'home-dir', re: /(?:\/Users\/|\/home\/)[A-Za-z0-9._-]+/g,
    hint: '用户主目录：示例请写成 <you> 或 <用户名> 占位符' },
  { id: 'pid', re: /\bPID\s*[:=]?\s*\d+/gi, hint: '进程号：文档里请写成 PID <已隐去>' },
  { id: 'token', re: /[?&]token=(?![…<.]*[)\s"'`]|[…<])[A-Za-z0-9._~+/-]{8,}/g,
    hint: '疑似真实 launch token：绝不能入库' },
  { id: 'private-ip', re: /\b(?:10|172\.(?:1[6-9]|2\d|3[01])|192\.168)\.\d{1,3}\.\d{1,3}\b/g,
    hint: '内网地址：确认是否需要出现在公开仓库' },
  { id: 'email', re: /[\w.+-]+@[\w-]+\.[A-Za-z]{2,}/g, hint: '邮箱：确认是否为公开联系方式' },
];

const args = process.argv.slice(2);
const scanAll = args.includes('--all');
const root = path.resolve(args.find((a) => !a.startsWith('--')) || path.join(__dirname, '..'));

/* 本机身份：运行时取，避免把机器名/用户名写进仓库 */
const identity = [
  { id: 'hostname', needle: process.env.COMPUTERNAME || os.hostname(), hint: '本机主机名' },
  { id: 'username', needle: process.env.USERNAME || (os.userInfo && os.userInfo().username), hint: '本机用户名' },
].filter((x) => x.needle && x.needle.length >= 3);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p, out); }
    else out.push(p);
  }
  return out;
}

function allowedPath(value) {
  if (BARE_DRIVE.test(value)) return true;
  // 正则在空白处截断（`C:\Program Files\…` 只会匹配到 `C:\Program`），
  // 且源码里常见转义写法（`C:\\Program Files\\…`）。两边都归一化后再比：
  // 「片段是某个白名单路径的前缀」就足以判定它属于该白名单。
  const norm = (s) => s.replace(/\\+/g, '\\').toUpperCase();
  const v = norm(value);
  return ALLOWED_PATHS.some((p) => {
    const a = norm(p);
    return v.startsWith(a) || a.startsWith(v);
  });
}

const findings = [];
for (const file of walk(root)) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  if (!scanAll && SKIP_REL.some((s) => rel.startsWith(s))) continue;
  if (!TEXT_EXT.has(path.extname(file).toLowerCase())) continue;
  let text;
  try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
  const lines = text.split(/\r?\n/);
  for (const rule of PII) {
    rule.re.lastIndex = 0;
    let m;
    while ((m = rule.re.exec(text)) !== null) {
      const value = m[0];
      if (rule.id === 'win-abs-path' && allowedPath(value)) continue;
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file: rel, line, id: rule.id, value: value.slice(0, 120), hint: rule.hint });
      if (rule.re.lastIndex === m.index) rule.re.lastIndex++;
    }
  }
  for (const idn of identity) {
    const re = new RegExp(idn.needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      findings.push({ file: rel, line, id: idn.id, value: m[0], hint: idn.hint + '：请用通用占位符' });
      if (re.lastIndex === m.index) re.lastIndex++;
    }
  }
}

if (findings.length === 0) {
  console.log(JSON.stringify({ root, scanned: 'all text files' + (scanAll ? ' (incl. dist/)' : ''), findings: [], passed: true }, null, 2));
  process.exit(0);
}

const byFile = new Map();
for (const f of findings) {
  if (!byFile.has(f.file)) byFile.set(f.file, []);
  byFile.get(f.file).push(f);
}
console.log(JSON.stringify({
  root,
  scanned: 'all text files' + (scanAll ? ' (incl. dist/)' : ''),
  total: findings.length,
  files: [...byFile.entries()].map(([file, hits]) => ({ file, count: hits.length, hits })),
  passed: false,
}, null, 2));
console.log('\n建议：改成通用示例值或占位符；确属刻意保留的通用路径，请加进 ALLOWED_PATHS 并说明理由。');
process.exit(1);
