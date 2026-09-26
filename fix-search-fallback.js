// 修复：① 酷狗换可用域名（多域名轮询） ② 搜索失败/0结果自动回退网易云
const fs = require('fs');

// ---------- 1) platforms.js：酷狗多域名轮询 ----------
let p = fs.readFileSync('src/sources/platforms.js', 'utf8').replace(/\r\n/g, '\n');
const oldKugou = "    const url = 'https://mobilecdn.kugou.com/api/v3/search/song?format=json&showtype=1&page=1&pagesize=' +\n      encodeURIComponent(limit) + '&keyword=' + encodeURIComponent(keywords);\n    const j = await getJson(url);";
const newKugou = [
  '    // 酷狗有多个 CDN 域名，逐个尝试（mobilecdn 在部分网络已不可达）',
  "    const qs = 'api/v3/search/song?format=json&showtype=1&page=1&pagesize=' + encodeURIComponent(limit) + '&keyword=' + encodeURIComponent(keywords);",
  "    const hosts = ['https://mobiles.kugou.com/', 'https://msearchcdn.kugou.com/', 'https://mobilecdn.kugou.com/'];",
  '    let j = null;',
  '    let lastErr = null;',
  '    for (const h of hosts) {',
  '      try { j = await getJson(h + qs); break; } catch (e) { lastErr = e; }',
  '    }',
  "    if (!j) throw lastErr || new Error('酷狗接口不可用');",
].join('\n');
if (!p.includes(oldKugou)) { console.log('!! 酷狗锚点未找到'); process.exit(1); }
p = p.replace(oldKugou, newKugou);
fs.writeFileSync('src/sources/platforms.js', p);
console.log('① 酷狗改为多域名轮询（mobiles → msearchcdn → mobilecdn）✅');

// ---------- 2) main.js：搜索失败/0 结果自动回退网易云 ----------
let m = fs.readFileSync('electron/main.js', 'utf8').replace(/\r\n/g, '\n');
const oldSearch = "    const mod = PLATFORM_MAP[key];\n    if (!mod) return { ok: false, error: '未知音源：' + key };\n    const [list, lxList] = await Promise.all([mod.search(kw), lxTask]);\n    return { ok: true, data: list.concat(lxList), source: key };";
const newSearch = [
  '    const mod = PLATFORM_MAP[key];',
  "    if (!mod) return { ok: false, error: '未知音源：' + key };",
  '    // 平台接口经常变动/被限流：失败或 0 结果时自动回退到内置网易云，并告知用户原因',
  '    let list = [];',
  '    let failReason = \'\';',
  '    try {',
  '      list = await mod.search(kw);',
  '    } catch (e) {',
  '      failReason = String(e && e.message || e);',
  "      logLine('[songwave] 平台搜索失败(' + key + '):', failReason);",
  '    }',
  '    if (!list.length) {',
  '      const neteaseList = await netease.search(kw);',
  '      const lxList2 = await lxTask;',
  '      if (neteaseList.length) {',
  '        return {',
  '          ok: true,',
  '          data: neteaseList.concat(lxList2),',
  "          source: 'netease',",
  '          fallbackFrom: key,',
  "          note: (failReason ? ('该音源接口不可用（' + failReason.slice(0, 40) + '）') : '该音源没有结果') + '，已自动改用网易云',",
  '        };',
  '      }',
  "      if (failReason) return { ok: false, error: mod.label + ' 搜索失败：' + failReason };",
  '    }',
  '    const lxList = await lxTask;',
  '    return { ok: true, data: list.concat(lxList), source: key };',
].join('\n');
if (!m.includes(oldSearch)) { console.log('!! 搜索锚点未找到'); process.exit(1); }
m = m.replace(oldSearch, newSearch);
fs.writeFileSync('electron/main.js', m);
console.log('② main.js：搜索失败/0 结果 → 自动回退网易云 ✅');

// ---------- 3) renderer.js：提示回退 + 自动切到网易云 ----------
let r = fs.readFileSync('app/renderer.js', 'utf8').replace(/\r\n/g, '\n');
const oldDo = [
  "    const r = await window.songwave.search(kw, curSource);",
  "    if (!r.ok) { setStatus('搜索失败：' + r.error); return; }",
  '    pushSearchHistory(kw);',
].join('\n');
const newDo = [
  "    const r = await window.songwave.search(kw, curSource);",
  "    if (!r.ok) { setStatus('搜索失败：' + r.error, 7000); return; }",
  '    pushSearchHistory(kw);',
  '    // 平台接口不可用时后端已自动回退网易云：这里同步音源选择并提示用户',
  '    if (r.fallbackFrom) {',
  '      curSource = r.source || \'netease\';',
  "      try { localStorage.setItem('songwave.source', curSource); } catch (e) { /* ignore */ }",
  "      document.querySelectorAll('#src-chips .chip').forEach((x) => x.classList.toggle('active', x.dataset.src === curSource));",
  '      setStatus((r.note || \'已自动回退网易云\'), 8000);',
  '    }',
].join('\n');
if (!r.includes(oldDo)) { console.log('!! 渲染层搜索锚点未找到'); process.exit(1); }
r = r.replace(oldDo, newDo);
fs.writeFileSync('app/renderer.js', r);
console.log('③ renderer.js：回退提示 + 自动切换音源 ✅');
