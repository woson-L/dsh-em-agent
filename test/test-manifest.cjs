/* ============================================================================
 *  插件契约测试（不需要浏览器、不需要 DSH 在跑）
 *
 *  为什么单独有这一套：
 *    2026-10-18 的真实故障不是页面代码错，而是**清单元数据**错 ——
 *    `plugin/package.json` 的 peerDependencies 把
 *    `@deepseek-ai/dsh-host-webserver` 钉在 `^0.1.1-rc.2`。DSH 升到 0.2.0-rc.2 后，
 *    这个 range 不再匹配（0.x 的 caret 上界是 `<0.2.0-0`），boot 阶段直接
 *    `skipping profile bundle "dsh-em-agent"`，整条路由消失 —— 表现为
 *    `/em-agent` 404，而所有浏览器套件只会一起失败，指向不了真正的原因。
 *
 *  本套件分三组：
 *    A 清单：版本号、bundle patch、files 列表、peerDependencies 是否存在
 *    B 运行时兼容：把声明的 range 拿去和**本机实际安装的** DSH 版本比对
 *                  （本机没有 DSH 或没有 semver 时该组记 SKIP，不判失败）
 *    C 插件契约：真实 import 插件，用真实的 http.Server 挂上它注册的路由，
 *               断言 200/405/HEAD/别名/释放
 *
 *  用法：
 *    node test/test-manifest.cjs
 *  可选环境变量：
 *    DSH_PKG_ROOT  DSH 包所在的 `.../@deepseek-ai/dsh` 目录（自动探测失败时用）
 *
 *  输出 `{ results, failures, passed }`；退出码 0 = 全过（SKIP 不算失败）。
 * ========================================================================== */
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const PLUGIN_DIR = path.join(ROOT, 'plugin');
const PLUGIN_JSON = path.join(PLUGIN_DIR, 'package.json');
const PANEL = path.join(PLUGIN_DIR, 'panel.html');
const PANEL_CLASSIC = path.join(PLUGIN_DIR, 'panel.html');

const results = {};
const failures = [];
function check(name, fn) {
  try {
    const value = fn();
    results[name] = value === undefined ? true : value;
  } catch (e) {
    results[name] = false;
    failures.push({ assertion: name, error: String((e && e.message) || e) });
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg); }

/* ---------------------------------------------------------------- A 清单 */
const manifest = JSON.parse(fs.readFileSync(PLUGIN_JSON, 'utf8'));

check('name 为 dsh-em-agent', () => {
  assert(manifest.name === 'dsh-em-agent', `实际是 ${manifest.name}`);
  return manifest.name;
});
check('version 是精确三段语义化版本', () => {
  assert(/^\d+\.\d+\.\d+$/.test(String(manifest.version)), `实际是 ${manifest.version}`);
  return manifest.version;
});
check('声明了 bundle patch', () => {
  const rel = manifest.dsh && manifest.dsh.bundle && manifest.dsh.bundle.patch;
  assert(typeof rel === 'string' && rel.length > 0, 'dsh.bundle.patch 缺失');
  const p = path.join(PLUGIN_DIR, rel);
  assert(fs.existsSync(p), `patch 文件不存在: ${rel}`);
  const text = fs.readFileSync(p, 'utf8');
  assert(text.includes('id: em-agent-panel'), 'patch 里没有 id: em-agent-panel');
  assert(text.includes('name: dsh-em-agent'), 'patch 里没有 name: dsh-em-agent');
  return rel;
});
check('files 覆盖运行期必需文件', () => {
  const files = Array.isArray(manifest.files) ? manifest.files : [];
  for (const f of ['index.js', 'client.js', 'panel.html', 'cordis.patch.yml']) {
    assert(files.includes(f), `files 里缺少 ${f}`);
  }
  return files.join(',');
});
check('声明了客户端半边（dsh.client + ./client 导出）', () => {
  const client = manifest.dsh && manifest.dsh.client;
  assert(client && typeof client === 'object', 'dsh.client 缺失 —— 前端入口不会加载');
  assert(client.platform === 'web', `platform 实际是 ${client.platform}`);
  assert(Array.isArray(client.inject) && client.inject.length > 0, 'dsh.client.inject 为空');
  for (const pkg of client.inject) {
    assert(/^@deepseek-ai\/dsh-/.test(pkg), `inject 里混入了非 dsh 包: ${pkg}`);
  }
  const exported = manifest.exports && manifest.exports['./client'];
  assert(exported === './client.js', `exports["./client"] 实际是 ${exported}`);
  const p = path.join(PLUGIN_DIR, 'client.js');
  assert(fs.existsSync(p), 'client.js 不存在');
  const src = fs.readFileSync(p, 'utf8');
  assert(src.includes(`id: '${manifest.name}'`), 'client.js 里的工厂 id 必须等于包名');
  assert(src.includes('__ModuleLoader__'), 'client.js 没有走 window.__ModuleLoader__.load 注册');
  return `${client.inject.length} 个 inject · ${exported}`;
});
check('插件已发布 npm 元数据（repository / license）', () => {
  assert(manifest.repository && manifest.repository.url, '缺少 repository.url');
  assert(manifest.license === 'MIT', `license 实际是 ${manifest.license}`);
  return manifest.license;
});

/* ------------------------------------------------------- B 运行时兼容性 */
const PEER = '@deepseek-ai/dsh-host-webserver';

/** 探测本机安装的 DSH 包根目录（`.../@deepseek-ai/dsh`）。找不到返回 null。 */
function findDshRoot() {
  const candidates = [];
  if (process.env.DSH_PKG_ROOT) candidates.push(process.env.DSH_PKG_ROOT);
  if (process.env.APPDATA) {
    candidates.push(path.join(process.env.APPDATA, 'npm', 'node_modules', '@deepseek-ai', 'dsh'));
  }
  candidates.push(path.join(path.dirname(process.execPath), '..', 'lib', 'node_modules', '@deepseek-ai', 'dsh'));
  candidates.push(path.join(path.dirname(process.execPath), 'node_modules', '@deepseek-ai', 'dsh'));
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'node_modules', '@deepseek-ai', 'dsh-host-webserver', 'package.json'))) return c;
    } catch (e) { /* 权限或路径异常，继续找下一个 */ }
  }
  return null;
}
function readJson(p) { return JSON.parse(fs.readFileSync(p, 'utf8')); }

const dshRoot = findDshRoot();
let runtime = null;
if (dshRoot) {
  try {
    runtime = {
      root: dshRoot,
      dsh: readJson(path.join(dshRoot, 'package.json')).version,
      webserver: readJson(path.join(dshRoot, 'node_modules', '@deepseek-ai', 'dsh-host-webserver', 'package.json')).version,
    };
  } catch (e) { runtime = null; }
}

/* semver：先用本机已有的，其次用 DSH 自带的那份。两者都拿不到就整组 SKIP ——
   本仓库不引入任何依赖，所以这里绝不 npm install。 */
function findSemver() {
  try {
    const s = require('semver');
    if (typeof s.satisfies === 'function') return s;
  } catch (e) { /* 本机没有 semver，继续找 DSH 自带的那份 */ }
  if (dshRoot) {
    try {
      const s = require(path.join(dshRoot, 'node_modules', 'semver'));
      if (typeof s.satisfies === 'function') return s;
    } catch (e) { /* 同上 */ }
  }
  return null;
}
const semver = findSemver();

results['探测到的 DSH 运行时'] = runtime
  ? `dsh@${runtime.dsh} / ${PEER}@${runtime.webserver}`
  : '未探测到本机 DSH 安装（可用 DSH_PKG_ROOT 指定）';

const PEER_RANGE = manifest.peerDependencies && manifest.peerDependencies[PEER];

if (!semver) {
  results['peer range 版本矩阵'] = 'SKIP（找不到 semver：本机没装，DSH 也没装）';
  results['peer range 与本机 DSH 运行时兼容'] = 'SKIP（同上）';
} else {
  check('声明了 peerDependencies', () => {
    assert(typeof PEER_RANGE === 'string' && PEER_RANGE.trim() !== '', `peerDependencies["${PEER}"] 缺失`);
    return PEER_RANGE;
  });

  /* 版本矩阵 = 「老版本也能用、新版本也别被误杀」的可执行契约。
     上界刻意挡在 0.3.0-0 之前：比静默 404 更糟的是"装上去再把 DSH 启动搞挂"，
     所以未来破坏性变更应当被这一步拒掉，而不是放进来赌 API 没变。 */
  const HOST_ACCEPT = [
    '0.1.0', '0.1.0-rc.1', '0.1.1-rc.0', '0.1.1-rc.2', '0.1.5',
    '0.2.0-rc.1', '0.2.0-rc.2', '0.2.0', '0.2.1-rc.2', '0.2.9',
  ];
  const HOST_REJECT = ['0.0.9', '0.3.0-0', '0.3.0-rc.1', '0.3.0', '0.4.0', '1.0.0'];

  check('peer range 接受 0.1 与 0.2 全线（含预发布）', () => {
    const bad = HOST_ACCEPT.filter((v) => !semver.satisfies(v, PEER_RANGE, { includePrerelease: true }));
    assert(bad.length === 0, `这些被拒绝: ${bad.join(', ')}（range = ${PEER_RANGE}）`);
    return `${HOST_ACCEPT.length} 个版本全部接受`;
  });

  check('peer range 拒绝 0.3 及以后', () => {
    const bad = HOST_REJECT.filter((v) => semver.satisfies(v, PEER_RANGE, { includePrerelease: true }));
    assert(bad.length === 0, `这些被误接受: ${bad.join(', ')}（range = ${PEER_RANGE}）`);
    return `${HOST_REJECT.length} 个版本全部拒绝`;
  });

  /* 负向对照：证明上面两条不是空转 —— 旧写法必须同时踩中「拒老版本」与「被 0.2 拒」。 */
  check('负向对照：旧写法 ^0.1.1-rc.2 会拒 0.1.0 与 0.2.x', () => {
    const legacy = '^0.1.1-rc.2';
    const noOld = !semver.satisfies('0.1.0', legacy, { includePrerelease: true });
    const noNew = !semver.satisfies('0.2.0-rc.2', legacy, { includePrerelease: true });
    assert(noOld && noNew, '旧写法本应同时拒掉 0.1.0 与 0.2.0-rc.2，否则本组失去对照意义');
    return `${legacy} ⊉ {0.1.0, 0.2.0-rc.2}`;
  });

  if (!runtime) {
    results['peer range 与本机 DSH 运行时兼容'] = 'SKIP（未探测到本机 DSH 安装）';
  } else {
    /* 与 dsh-app-boot 的判定完全一致：includePrerelease 必须为 true，
       否则 0.x 的预发布版本会被误判为不兼容。 */
    check('peer range 与本机 DSH 运行时兼容', () => {
      const ok = semver.satisfies(runtime.webserver, PEER_RANGE, { includePrerelease: true });
      assert(ok, `range "${PEER_RANGE}" 不接受运行时 ${runtime.webserver}` +
        ' —— 这会让 DSH 在 boot 阶段整包跳过插件，路由直接 404');
      return `${PEER_RANGE} ⊇ ${runtime.webserver}`;
    });
  }
}

/* --------------------------------------------------------- C 插件契约 */
async function contractTests() {
  const mod = await import(pathToFileURL(path.join(PLUGIN_DIR, 'index.js')).href);
  const panelBytes = fs.readFileSync(PANEL);
  const classicBytes = fs.readFileSync(PANEL_CLASSIC);

  check('导出 name / inject / Config / apply', () => {
    assert(mod.name === 'dsh-em-agent', `name 实际是 ${mod.name}`);
    assert(Array.isArray(mod.inject) && mod.inject.includes('webServer'), 'inject 未声明 webServer');
    assert(mod.Config && mod.Config['~standard'] && typeof mod.Config['~standard'].validate === 'function', 'Config 不是 Standard Schema');
    assert(typeof mod.apply === 'function', 'apply 未导出');
    return 'ok';
  });

  const validate = mod.Config['~standard'].validate;

  check('Config：不写 config 时回落默认值', () => {
    const r = validate(undefined);
    assert(!r.issues, `意外报错: ${JSON.stringify(r.issues)}`);
    assert(r.value.routePath === mod.DEFAULT_ROUTE_PATH, `routePath 实际是 ${r.value.routePath}`);
    return r.value.routePath;
  });
  check('Config：未知键只记录不拒绝', () => {
    const r = validate({ routepath: '/x' });
    assert(!r.issues, `不应拒绝: ${JSON.stringify(r.issues)}`);
    assert(r.value.routePath === mod.DEFAULT_ROUTE_PATH, '未知键不应改变默认路径');
    assert(r.value.unknownKeys.includes('routepath'), 'unknownKeys 未记录拼错的键');
    return r.value.unknownKeys.join(',');
  });
  for (const [label, bad] of [
    ['routePath 不是字符串', { routePath: 123 }],
    ['routePath 不以 / 开头', { routePath: 'no-slash' }],
    ['routePath 以 / 结尾', { routePath: '/trailing/' }],
  ]) {
    check(`Config：${label} 被拒绝`, () => {
      const r = validate(bad);
      assert(r.issues && r.issues.length > 0, '本应报错却通过了');
      return r.issues[0].message;
    });
  }

  /* 用假的 ctx 挂载，再用真实的 http.Server 提供它注册的路由 */
  const registered = [];
  const disposers = [];
  const indexTaps = [];
  const ctx = {
    get() { return undefined; },
    effect(fn) { const d = fn(); if (typeof d === 'function') disposers.push(d); },
    webServer: {
      /* 真实 WebServer 是 Service，带 host/port 取值器与 tapIndex；
         假 ctx 必须同样具备，否则测不到 origin 注入那条路径。 */
      host: '127.0.0.1',
      port: 43210,
      register(route) {
        assert(route && (route.kind === 'exact' || route.kind === 'prefix'), 'route.kind 非法');
        assert(typeof route.path === 'string' && typeof route.handler === 'function', 'route 字段不完整');
        registered.push(route);
        return () => { const i = registered.indexOf(route); if (i >= 0) registered.splice(i, 1); };
      },
      tapIndex(transform) {
        assert(typeof transform === 'function', 'tapIndex 需要一个纯函数');
        indexTaps.push(transform);
        return () => { const i = indexTaps.indexOf(transform); if (i >= 0) indexTaps.splice(i, 1); };
      },
    },
  };

  check('apply 注册主路径 + 旧路径别名', () => {
    const cfg = validate(undefined).value;
    mod.apply(ctx, cfg);
    const paths = registered.map((r) => r.path).sort();
    assert(paths.includes(mod.DEFAULT_ROUTE_PATH), `缺少主路径 ${mod.DEFAULT_ROUTE_PATH}`);
    if (mod.LEGACY_ROUTE_PATH) assert(paths.includes(mod.LEGACY_ROUTE_PATH), `缺少别名 ${mod.LEGACY_ROUTE_PATH}`);
      const bridge = (mod.DEFAULT_ROUTE_PATH === '/' ? '' : mod.DEFAULT_ROUTE_PATH) + '/run-bridge.js';
      const mainCount = paths.filter((p) => p === mod.DEFAULT_ROUTE_PATH).length;
      assert(mainCount === 2, 'main route registered twice (exact + prefix): ' + paths.join(','));
      assert(paths.includes(bridge), 'missing bridge route: ' + bridge);
      assert(paths.length === (mod.LEGACY_ROUTE_PATH ? 4 : 3), 'unexpected route count: ' + paths.join(','));
    return paths.join(' ');
  });

  check('apply 通过 tapIndex 注入真实 origin（端口取自 webServer）', () => {
    assert(indexTaps.length === 1, `tapIndex 注册了 ${indexTaps.length} 次（应为 1 次）`);
    const html = '<html><head><title>t</title></head><body></body></html>';
    const expected = '<meta name="dsh-em-agent-origin" content="http://127.0.0.1:43210">';
    const out = indexTaps[0](html);
    assert(out.includes(expected), `注入结果里没有 ${expected}`);
    assert(out.indexOf(expected) < out.indexOf('</head>'), 'meta 未注入到 </head> 之前');
    assert(indexTaps[0](out) === out, '重复注入应当是幂等的');
    return expected;
  });

  const server = http.createServer((req, res) => {
    const pathname = new URL(req.url, 'http://127.0.0.1').pathname;
    const route = registered.find((r) => r.kind === 'exact' && r.path === pathname);
    if (route) return route.handler(req, res);
    res.writeHead(404, { 'content-type': 'text/plain' });
    res.end('fallback');
  });
  await new Promise((res) => server.listen(0, '127.0.0.1', res));
  const base = `http://127.0.0.1:${server.address().port}`;

  try {
    const r = await fetch(`${base}${mod.DEFAULT_ROUTE_PATH}`);
    const body = Buffer.from(await r.arrayBuffer());
    check('GET 主路径 → 200 + 注入 origin meta（其余与 panel.html 逐字节一致）', () => {
      assert(r.status === 200, `状态码是 ${r.status}`);
      assert(/text\/html/.test(r.headers.get('content-type') || ''), `content-type 是 ${r.headers.get('content-type')}`);
      assert(r.headers.get('cache-control') === 'no-store', 'cache-control 不是 no-store');
      assert(r.headers.get('x-dsh-em-agent') === 'panel',
        '缺少 x-dsh-em-agent 标记头 —— 客户端无法判别相对路径是否真的命中面板');
      const text = body.toString('utf8');
      const meta = '<meta name="dsh-em-agent-origin" content="http://127.0.0.1:43210">';
      assert(text.indexOf(meta) >= 0, '响应里没有注入 origin meta —— 桌面版会掉进 file:// 降级');
         assert(/<meta name="dsh-em-agent-token" content="[0-9a-f-]{36}">/.test(text), 'missing token meta');
         assert(/<script src="[^"]*run-bridge\.js" defer><\/script>/.test(text), 'missing bridge script tag');
         const stripped = Buffer.from(text.split(meta).join('').replace(/<meta name="dsh-em-agent-token" content="[^"]*">/g, '').replace(/<script src="[^"]*run-bridge\.js" defer><\/script>/g, ''), 'utf8');
      assert(Buffer.compare(stripped, panelBytes) === 0,
        '去掉注入的 meta 后与 panel.html 不一致 —— 路由不应改动产物本身');
      return `${r.status} / ${body.length} 字节（含 ${meta.length} 字节 meta）`;
    });

    const head = await fetch(`${base}${mod.DEFAULT_ROUTE_PATH}`, { method: 'HEAD' });
    const headBody = Buffer.from(await head.arrayBuffer());
    check('HEAD 主路径 → 200 且无响应体', () => {
      assert(head.status === 200, `状态码是 ${head.status}`);
      assert(headBody.length === 0, `HEAD 带了 ${headBody.length} 字节响应体`);
      assert(Number(head.headers.get('content-length')) === body.length,
        'content-length 与 GET 的实际长度不一致');
      return `${head.status} / content-length=${head.headers.get('content-length')}`;
    });

    const post = await fetch(`${base}${mod.DEFAULT_ROUTE_PATH}`, { method: 'POST', body: 'x' });
    check('POST 主路径 → 405 且带 Allow 头', () => {
      assert(post.status === 405, `状态码是 ${post.status}`);
      assert((post.headers.get('allow') || '').toUpperCase() === 'GET, HEAD', `allow 是 ${post.headers.get('allow')}`);
      return `${post.status} / allow=${post.headers.get('allow')}`;
    });

    if (mod.LEGACY_ROUTE_PATH) {
      const legacy = await fetch(`${base}${mod.LEGACY_ROUTE_PATH}`);
      const legacyBody = Buffer.from(await legacy.arrayBuffer());
      check('GET 旧路径别名 → 200 且与主路径逐字节相同', () => {
        assert(legacy.status === 200, `状态码是 ${legacy.status}`);
        assert(Buffer.compare(legacyBody, body) === 0,
          '别名响应与主路径不一致 —— 两个路径应当共用同一份实现');
        return `${mod.LEGACY_ROUTE_PATH} → 200 / ${legacyBody.length} 字节`;
      });
    }

    const other = await fetch(`${base}/definitely-not-registered`);
    check('未注册路径落到 fallback（证明路由是精确匹配）', () => {
      assert(other.status === 404, `状态码是 ${other.status}`);
      return other.status;
    });

    disposers.forEach((d) => d());
    const afterDispose = await fetch(`${base}${mod.DEFAULT_ROUTE_PATH}`);
    check('dispose 之后主路径不再由插件响应', () => {
      assert(afterDispose.status === 404, `释放后仍是 ${afterDispose.status}`);
      assert(registered.length === 0, `仍有 ${registered.length} 条路由未释放`);
      return '404 / 0 条残留';
    });
  } finally {
    await new Promise((res) => server.close(res));
  }
}

contractTests()
  .catch((e) => {
    failures.push({ assertion: '插件契约组', error: String((e && e.stack) || e) });
  })
  .then(() => {
    const passed = failures.length === 0;
    console.log(JSON.stringify({ results, failures, passed }, null, 2));
    if (!passed) process.exit(1);
  });
