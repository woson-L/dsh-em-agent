/* ============================================================================
 *  自定义频段 / 自定义特殊需求 回归测试
 *
 *  覆盖：入口按钮 / 新增 / 行内编辑 / 频率范围校验（非法、重复）/ 删除 /
 *        参与配置读取与指令组装 / localStorage 持久化 / 老存档向后兼容 /
 *        损坏存档健壮性 / 「4.80 GHz 效率抑制」确实已从界面与指令中消失
 *
 *  用法： node test/test-custom-items.cjs [URL]
 * ========================================================================== */
const { spawn } = require('node:child_process');
const path = require('node:path');
const os = require('node:os');

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const URL = process.argv[2] || 'http://127.0.0.1:3080/em-agent';
const PORT = 9373;
const UD = path.join(os.tmpdir(), 'dsh-antenna-custom-items-test');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const STATE_KEY = 'cst-console-config-v1';

/* ---------- 阶段 A：全新状态下新增、编辑、校验 ---------- */
const PHASE_A = `(() => {
  const R = {};
  const $ = (id) => document.getElementById(id);
  const fire = (el, t) => el.dispatchEvent(new Event(t, { bubbles: true }));
  const cfg = () => readConfig();
  const instr = () => buildInstruction(readConfig());

  // 填最小必填项，让 buildInstruction 能产出完整指令
  $('inpProjectDir').value = 'E:/DeepSeek/DATA/CST2026';
  $('inpProjectFile').value = 'demo.cst';
  $('inpAntennaPath').value = 'Components/ANT/antenna/';
  $('inpSubstratePath').value = 'Components/substrate/SUB';

  // ---------- 0. 效率抑制项已彻底移除 ----------
  R.effInputsGone = !$('spEfficiencySuppress') && !$('spEffTarget');
  R.effTextGoneFromSpecial = document.getElementById('secSpecial').textContent.indexOf('4.80') < 0;
  R.effGoneFromInstruction = instr().indexOf('效率抑制') < 0 && instr().indexOf('4.80') < 0;
  R.isolationKept = !!$('spIsolation') && !!$('spIsoMax');
  R.customTextKept = !!$('spCustom') && !!$('spCustomText');

  // ---------- 0b. 「增加短截线」已从 ⑤ 异常处理策略移除 ----------
  // 注意：这三个复选框从来没有接入 config 记忆（不在 STATE_FIELD_IDS、也没有
  // savePanelState 监听），始终按 HTML 默认值渲染，所以本项移除不涉及存档迁移。
  R.stubGone = !$('stStub');
  R.strategyKept = !!$('stScale') && !!$('stMesh');
  R.strategyGroupCount = document.querySelectorAll('#strategyGroup input[type=checkbox]').length;
  R.strategiesInConfig = cfg().strategies.join('|');
  R.stubGoneFromInstruction = instr().indexOf('增加短截线') < 0;
  R.strategyPresentInInstruction = instr().indexOf('缩放重试') >= 0 && instr().indexOf('强制细化网格') >= 0;

  // ---------- 1. 两个入口按钮 ----------
  R.addBandBtnExists = !!$('btnAddBand');
  R.addSpecBtnExists = !!$('btnAddSpec');
  R.presetBandCount = document.querySelectorAll('#bandCards .band-card').length;
  R.emptyHintShown = document.querySelectorAll('#customSpecList .spec-empty').length === 1;

  // ---------- 2. 新增频段 ----------
  $('btnAddBand').click();
  let cards = document.querySelectorAll('#bandCards .band-card');
  R.bandCountAfterAdd = cards.length;
  const last = cards[cards.length - 1];
  R.newBandHasRange = !!last.querySelector('.band-lo') && !!last.querySelector('.band-hi');
  R.newBandHasDelete = !!last.querySelector('.band-del');
  R.customBandsLen = customBands.length;
  // 预设频段默认只启用 band-24，所以"启用数"是 1 预设 + 1 自定义；
  // 真正要断言的是：新频段确实进了 readConfig 的输出，且带着正确的 key/label。
  R.enabledBandCount = cfg().bands.length;
  R.newBandInConfig = cfg().bands.some((b) => b.key === customBands[0].key && b.label === customBands[0].label);
  R.newBandDefaultKey = customBands[0].key;
  R.newBandIsEnabled = cfg().bands.some((b) => b.key === customBands[0].key && b.on === true);

  // 预设频段不应出现删除按钮（只有自定义项可删）
  R.presetHasNoDelete = document.querySelectorAll('#bandCards .band-card')[0].querySelector('.band-del') === null;

  // ---------- 3. 行内编辑：key/label 同步 + 状态迁移 ----------
  const sel = last.querySelector('select');
  sel.value = '-15'; fire(sel, 'change');            // 先造一个"需要被迁移"的状态
  const lo = last.querySelector('.band-lo'), hi = last.querySelector('.band-hi');
  lo.value = '3.60'; hi.value = '3.80'; fire(lo, 'change');
  R.bandCountStableAfterEdit = document.querySelectorAll('#bandCards .band-card').length;
  R.editedKey = customBands[0].key;
  R.editedLabel = customBands[0].label;
  R.thresholdMigrated = cfg().bands.some((b) => b.key === customBands[0].key && b.threshold === -15);
  R.bandKeyChanged = customBands[0].key !== R.newBandDefaultKey;

  // ---------- 4. 重复范围必须被拒绝（预设 2.40-2.48）----------
  let c = document.querySelectorAll('#bandCards .band-card')[3];
  let lo2 = c.querySelector('.band-lo'), hi2 = c.querySelector('.band-hi');
  lo2.value = '2.40'; hi2.value = '2.48'; fire(lo2, 'change');
  R.duplicateRangeRejected = customBands[0].key === R.editedKey;

  // ---------- 5. 非法范围必须被拒绝 ----------
  c = document.querySelectorAll('#bandCards .band-card')[3];
  lo2 = c.querySelector('.band-lo'); hi2 = c.querySelector('.band-hi');
  lo2.value = '5'; hi2.value = '2'; fire(lo2, 'change');
  R.invalidRangeRejected = customBands[0].key === R.editedKey;

  // ---------- 6. 新增特殊需求并参与指令 ----------
  $('btnAddSpec').click();
  R.specRowCount = document.querySelectorAll('#customSpecList .spec-row').length;
  R.emptyHintGoneAfterAdd = document.querySelectorAll('#customSpecList .spec-empty').length === 0;
  const row = document.querySelector('#customSpecList .spec-row');
  row.querySelector('.spec-name').value = '增益';
  fire(row.querySelector('.spec-name'), 'input');
  row.querySelector('.spec-op').value = '>=';
  fire(row.querySelector('.spec-op'), 'change');
  row.querySelector('.spec-value').value = '2';
  fire(row.querySelector('.spec-value'), 'input');
  row.querySelector('.spec-unit').value = 'dBi';
  fire(row.querySelector('.spec-unit'), 'input');
  const ins = instr();
  R.instructionHasSpec = ins.indexOf('增益 不低于 2 dBi') >= 0;
  R.configSpecCount = (cfg().special.specs || []).length;
  R.configSpecOp = cfg().special.specs[0].op;

  // 未填名称的空行不应进入指令
  $('btnAddSpec').click();
  R.blankSpecNotInConfig = (cfg().special.specs || []).length === 1;
  R.specRowCountAfterBlankAdd = document.querySelectorAll('#customSpecList .spec-row').length;

  // ---------- 7. 持久化写入 ----------
  const raw = JSON.parse(localStorage.getItem(${JSON.stringify(STATE_KEY)}));
  R.storedCustomBands = Array.isArray(raw.customBands) ? raw.customBands.length : -1;
  R.storedCustomSpecs = Array.isArray(raw.customSpecs) ? raw.customSpecs.length : -1;
  R.storedBandKey = raw.customBands && raw.customBands[0] ? raw.customBands[0].key : '';
  R.storedSpecName = raw.customSpecs && raw.customSpecs[0] ? raw.customSpecs[0].name : '';
  R.legacyFieldsKept = !!raw.fields && raw.fields.spIsolation !== undefined;

  return R;
})()`;

/* ---------- 阶段 B：重载后应恢复；随后删除并验证 ---------- */
const PHASE_B = `(() => {
  const R = {};
  const $ = (id) => document.getElementById(id);
  const cfg = () => readConfig();

  R.restoredBandCount = document.querySelectorAll('#bandCards .band-card').length;
  R.restoredCustomBands = customBands.length;
  R.restoredBandKey = customBands[0] ? customBands[0].key : '';
  R.restoredBandLabel = customBands[0] ? customBands[0].label : '';
  R.restoredSpecRows = document.querySelectorAll('#customSpecList .spec-row').length;
  R.restoredSpecName = document.querySelector('#customSpecList .spec-name') ? document.querySelector('#customSpecList .spec-name').value : '';
  R.restoredSpecInConfig = (cfg().special.specs || []).length;
  R.restoredNoEmptyHint = document.querySelectorAll('#customSpecList .spec-empty').length === 0;

  // 删除第一条（已填写的）特殊需求：指令里不应再出现它；剩下的是空行，不进配置
  document.querySelector('#customSpecList .spec-del').click();
  R.specRowsAfterOneDelete = document.querySelectorAll('#customSpecList .spec-row').length;
  R.specsInConfigAfterDelete = (cfg().special.specs || []).length;
  // 断言完整生成行，而不是「增益」二字：静态前言里本来就含「效率/增益」字样
  R.instrNoLongerHasSpec = buildInstruction(readConfig()).indexOf('增益 不低于 2 dBi') < 0;
  R.emptyHintHiddenWhileOneRemains = document.querySelectorAll('#customSpecList .spec-empty').length;

  // 再删掉剩下那条空行：空态提示应回来
  document.querySelector('#customSpecList .spec-del').click();
  R.specRowsAfterAllDelete = document.querySelectorAll('#customSpecList .spec-row').length;
  R.emptyHintBackAfterAllDeleted = document.querySelectorAll('#customSpecList .spec-empty').length;

  // 删除自定义频段
  const del = document.querySelector('#bandCards .band-card:nth-child(4) .band-del');
  R.deleteButtonFound = !!del;
  if (del) del.click();
  R.bandCountAfterDelete = document.querySelectorAll('#bandCards .band-card').length;
  R.customBandsAfterDelete = customBands.length;
  R.customBandGoneFromConfig = !cfg().bands.some((b) => b.key === '3.6-3.8');
  R.enabledBandCountAfterDelete = cfg().bands.length;
  return R;
})()`;

/* ---------- 阶段 C：删除结果应持久化 ---------- */
const PHASE_C = `(() => {
  const R = {};
  R.bandCountAfterReload = document.querySelectorAll('#bandCards .band-card').length;
  R.customBandsAfterReload = customBands.length;
  R.customSpecsAfterReload = customSpecs.length;
  R.specEmptyShown = document.querySelectorAll('#customSpecList .spec-empty').length === 1;
  R.pageAlive = !!document.getElementById('btnAddBand');
  return R;
})()`;

async function main() {
  const chrome = spawn(CHROME, [
    '--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run',
    '--no-default-browser-check', '--force-device-scale-factor=1',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${UD}`,
    '--window-size=1600,1080', 'about:blank',
  ], { stdio: 'ignore' });

  let targets = null;
  for (let i = 0; i < 60; i++) {
    try {
      targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      if (targets.some((t) => t.type === 'page')) break;
    } catch (e) {}
    await sleep(250);
  }
  const target = (targets || []).find((t) => t.type === 'page');
  if (!target) { console.log(JSON.stringify({ error: 'CDP 未就绪' })); chrome.kill(); return; }

  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  let seq = 0; const pending = new Map();
  ws.onmessage = (ev) => {
    const m = JSON.parse(ev.data);
    if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  };
  const send = (method, params) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, (m) => (m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
  const evalJs = async (expr) => {
    const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails.exception || r.exceptionDetails));
    return r.result.value;
  };
  const waitReady = async () => {
    for (let i = 0; i < 80; i++) {
      try { if (await evalJs("document.readyState==='complete' && !!document.getElementById('btnAddBand')")) return; } catch (e) {}
      await sleep(250);
    }
    throw new Error('页面未就绪');
  };
  const reload = async () => { await send('Page.reload', {}); await waitReady(); await sleep(600); };

  await send('Page.enable'); await send('Runtime.enable');
  await send('Page.navigate', { url: URL });
  await waitReady();
  await evalJs("(() => { try { localStorage.clear(); } catch (e) {} return true; })()");
  await reload();

  const a = await evalJs(PHASE_A);
  await reload();
  const b = await evalJs(PHASE_B);
  await reload();
  const c = await evalJs(PHASE_C);

  // ---------- 阶段 D：老存档（没有 customBands / customSpecs）必须照常工作 ----------
  const legacy = { fields: { spIsolation: true, spIsoMax: '-30' }, bandEnabled: ['band-24'], bandState: {} };
  await evalJs(`(() => { localStorage.setItem(${JSON.stringify(STATE_KEY)}, ${JSON.stringify(JSON.stringify(legacy))}); return true; })()`);
  await reload();
  const d = await evalJs(`(() => {
    const R = {};
    R.legacyNoCrash = !!document.getElementById('btnAddBand');
    R.legacyCustomBands = customBands.length;
    R.legacyCustomSpecs = customSpecs.length;
    R.legacyBandCount = document.querySelectorAll('#bandCards .band-card').length;
    R.legacyFieldRestored = document.getElementById('spIsoMax').value;
    R.legacyEmptyHint = document.querySelectorAll('#customSpecList .spec-empty').length;
    return R;
  })()`);

  // ---------- 阶段 E：损坏存档必须被丢弃而不是让页面崩掉 ----------
  const corrupt = {
    fields: {},
    bandEnabled: ['band-24'],
    bandState: {},
    customBands: [{ id: 'x' }, { id: 'y', range: { lo: 'a', hi: 'b' } }, { id: 'z', range: { lo: 5, hi: 2 } }, null],
    customSpecs: [{}, { id: 's1', name: 123, op: '???', value: null }],
  };
  await evalJs(`(() => { localStorage.setItem(${JSON.stringify(STATE_KEY)}, ${JSON.stringify(JSON.stringify(corrupt))}); return true; })()`);
  await reload();
  const e = await evalJs(`(() => {
    const R = {};
    R.corruptNoCrash = !!document.getElementById('btnAddBand');
    R.corruptCustomBands = customBands.length;
    R.corruptCustomSpecs = customSpecs.length;
    R.corruptSpecNameIsString = customSpecs.length ? typeof customSpecs[0].name === 'string' : false;
    R.corruptSpecOpNormalized = customSpecs.length ? customSpecs[0].op : '';
    R.corruptSpecValueIsString = customSpecs.length ? typeof customSpecs[0].value === 'string' : false;
    // 损坏数据之后仍然能正常新增
    document.getElementById('btnAddSpec').click();
    R.canStillAdd = customSpecs.length;
    return R;
  })()`);

  const all = Object.assign({}, a, b, c, d, e);
  const fails = [];
  const expect = (k, v) => { if (all[k] !== v) fails.push(`${k}: 期望 ${JSON.stringify(v)}，实际 ${JSON.stringify(all[k])}`); };

  // 阶段 A
  expect('effInputsGone', true);
  expect('effTextGoneFromSpecial', true);
  expect('effGoneFromInstruction', true);
  expect('isolationKept', true);
  expect('customTextKept', true);
  expect('stubGone', true);
  expect('strategyKept', true);
  expect('strategyGroupCount', 2);
  expect('strategiesInConfig', '缩放重试|强制细化网格');
  expect('stubGoneFromInstruction', true);
  expect('strategyPresentInInstruction', true);
  expect('addBandBtnExists', true);
  expect('addSpecBtnExists', true);
  expect('presetBandCount', 3);
  expect('emptyHintShown', true);
  expect('bandCountAfterAdd', 4);
  expect('newBandHasRange', true);
  expect('newBandHasDelete', true);
  expect('customBandsLen', 1);
  expect('enabledBandCount', 2);
  expect('newBandInConfig', true);
  expect('newBandIsEnabled', true);
  expect('presetHasNoDelete', true);
  expect('bandCountStableAfterEdit', 4);
  expect('editedKey', '3.6-3.8');
  expect('editedLabel', '3.6 – 3.8 GHz');
  expect('thresholdMigrated', true);
  expect('bandKeyChanged', true);
  expect('duplicateRangeRejected', true);
  expect('invalidRangeRejected', true);
  expect('specRowCount', 1);
  expect('emptyHintGoneAfterAdd', true);
  expect('instructionHasSpec', true);
  expect('configSpecCount', 1);
  expect('configSpecOp', '>=');
  expect('blankSpecNotInConfig', true);
  expect('specRowCountAfterBlankAdd', 2);
  expect('storedCustomBands', 1);
  expect('storedCustomSpecs', 2);
  expect('storedBandKey', '3.6-3.8');
  expect('storedSpecName', '增益');
  expect('legacyFieldsKept', true);
  // 阶段 B
  expect('restoredBandCount', 4);
  expect('restoredCustomBands', 1);
  expect('restoredBandKey', '3.6-3.8');
  expect('restoredBandLabel', '3.6 – 3.8 GHz');
  expect('restoredSpecRows', 2);
  expect('restoredSpecName', '增益');
  expect('restoredSpecInConfig', 1);
  expect('restoredNoEmptyHint', true);
  expect('specRowsAfterOneDelete', 1);
  expect('specsInConfigAfterDelete', 0);
  expect('instrNoLongerHasSpec', true);
  expect('emptyHintHiddenWhileOneRemains', 0);
  expect('specRowsAfterAllDelete', 0);
  expect('deleteButtonFound', true);
  expect('bandCountAfterDelete', 3);
  expect('customBandsAfterDelete', 0);
  expect('customBandGoneFromConfig', true);
  expect('enabledBandCountAfterDelete', 1);
  expect('emptyHintBackAfterAllDeleted', 1);
  // 阶段 C
  expect('bandCountAfterReload', 3);
  expect('customBandsAfterReload', 0);
  expect('customSpecsAfterReload', 0);
  expect('pageAlive', true);
  // 阶段 D
  expect('legacyNoCrash', true);
  expect('legacyCustomBands', 0);
  expect('legacyCustomSpecs', 0);
  expect('legacyBandCount', 3);
  expect('legacyFieldRestored', '-30');
  expect('legacyEmptyHint', 1);
  // 阶段 E
  expect('corruptNoCrash', true);
  expect('corruptCustomBands', 0);
  expect('corruptCustomSpecs', 1);
  expect('corruptSpecNameIsString', true);
  expect('corruptSpecOpNormalized', '<=');
  expect('corruptSpecValueIsString', true);
  expect('canStillAdd', 2);

  console.log(JSON.stringify({ results: all, failures: fails, passed: fails.length === 0 }, null, 2));
  ws.close(); chrome.kill();
  // 断言失败必须让退出码非零（见 docs/dev/tests.md 的约定）
  if (fails.length > 0) process.exit(1);
}
main().catch((e) => { console.log(JSON.stringify({ error: String((e && e.stack) || e) })); process.exit(1); });
