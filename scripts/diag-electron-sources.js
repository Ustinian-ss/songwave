// 在 Electron 运行时里诊断音源加载（排查「打包版卡住」）
// 用法：node_modules/electron/dist/electron.exe scripts/diag-electron-sources.js
const { app } = require('electron');
const fs = require('fs');
const path = require('path');

const LOG = path.join(__dirname, '..', 'diag-electron.log');
const log = (m) => { try { fs.appendFileSync(LOG, m + '\n'); } catch (e) {} };
const t0 = Date.now();

// 心跳：如果事件循环被脚本同步代码阻塞，心跳会中断（这是「界面卡死」的直接证据）
let beats = 0;
const hb = setInterval(() => { beats++; log('[hb] ' + (Date.now() - t0) + 'ms 心跳 ' + beats); }, 1000);

app.whenReady().then(async () => {
  try {
    log('=== Electron 运行时诊断开始 ===');
    log('electron=' + process.versions.electron + ' node=' + process.versions.node + ' chrome=' + process.versions.chrome);

    // 单独加载每个脚本，分别计时（谁卡住一眼就能看出）
    const { loadScript } = require('../src/sources/script-runtime');
    const dir = process.env.SONGWAVE_SOURCE_DIR || 'C:/Users/28102/AppData/Roaming/声浪 SongWave/script-sources';
    log('音源目录: ' + dir);
    const regPath = path.join(dir, 'sources.json');
    if (!fs.existsSync(regPath)) { log('（无注册表）'); finish(); return; }
    const list = JSON.parse(fs.readFileSync(regPath, 'utf8'));
    log('注册 ' + list.length + ' 个音源');

    for (const e of list) {
      const s = Date.now();
      try {
        const r = await loadScript(e.file, { name: e.name, version: e.version || '', initTimeoutMs: 6000 });
        log('  ✔ ' + e.name + ' | ' + (Date.now() - s) + 'ms | 平台 ' + Object.keys(r.sources).join(','));
      } catch (err) {
        log('  ✘ ' + e.name + ' | ' + (Date.now() - s) + 'ms | ' + String(err.message).slice(0, 60));
      }
    }
    log('全部脚本逐个加载完毕，总用时 ' + (Date.now() - t0) + 'ms');
    finish();
  } catch (e) {
    log('!!! 诊断异常: ' + ((e && e.stack) || e));
    finish();
  }
});

function finish() {
  clearInterval(hb);
  const blocked = (Date.now() - t0) / 1000 - beats;
  log('心跳次数 ' + beats + '（理论上限 ' + Math.round((Date.now() - t0) / 1000) + '）→ 事件循环被阻塞约 ' + Math.max(0, blocked).toFixed(1) + ' 秒');
  log('=== 诊断结束 ===');
  app.exit(0);
}
