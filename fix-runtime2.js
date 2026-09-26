// 根治 2：脚本异常不再逃逸 + 补齐沙箱浏览器 API
const fs = require('fs');
const p = 'src/sources/script-runtime.js';
let s = fs.readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

// 1) 回调抛错就地吞掉（否则会变成 unhandledRejection 把主进程打崩）
const oldCb = '    if (typeof callback === \'function\') callback(err, response, body);\n    return err;';
const newCb = [
  '    // 脚本的回调里可能抛错：就地吞掉并记录，绝不让它逃逸成未处理拒绝（会崩主进程）',
  "    if (typeof callback === 'function') {",
  '      try { callback(err, response, body); }',
  '      catch (e) {',
  "        console.log('[ext-source] 脚本回调抛错（已忽略）:', (e && e.message) || e);",
  '      }',
  '    }',
  '    return err;',
].join('\n');
if (!s.includes(oldCb)) { console.log('!! 回调锚点未找到'); process.exit(1); }
s = s.replace(oldCb, newCb);

// 2) 沙箱补齐浏览器 API（脚本常用来注册全局错误处理 / 计时器）
const oldSandbox = '    navigator: { userAgent: \'SongWave/0.3 (lx-runtime)\' },';
const newSandbox = [
  "    navigator: { userAgent: 'SongWave/2.0 (ext-source-runtime)' },",
  '    // 脚本常会调用这些浏览器 API：必须存在，否则脚本一加载就 TypeError',
  '    addEventListener: function () {},',
  '    removeEventListener: function () {},',
  '    setInterval: setInterval,',
  '    clearInterval: clearInterval,',
  '    document: { addEventListener: function () {}, removeEventListener: function () {}, createElement: function () { return { style: {} }; } },',
  "    location: { href: 'about:blank', search: '' },",
  '    self: null,',
].join('\n');
if (!s.includes(oldSandbox)) { console.log('!! 沙箱锚点未找到'); process.exit(1); }
s = s.replace(oldSandbox, newSandbox);

fs.writeFileSync(p, s);
console.log('script-runtime：回调异常隔离 + 浏览器 API 补齐 ✅');
