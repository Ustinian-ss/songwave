// 声浪 SongWave · Wallpaper Engine 壁纸库测试（离线；含真实机器扫描）
// 用法：node scripts/test-wallpaper-engine.js
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const we = require('../src/wallpaper-engine');

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log('  ✔', name); }
  else { fail++; console.error('  ✘', name, detail || ''); }
}

// ---------- 1) 合成一个假 Steam 库，验证解析逻辑 ----------
function makeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'songwave-we-'));
  const ws = path.join(root, 'steamapps', 'workshop', 'content', we.WE_APPID);
  // 视频壁纸
  const v = path.join(ws, '1111');
  fs.mkdirSync(v, { recursive: true });
  fs.writeFileSync(path.join(v, 'project.json'), JSON.stringify({ type: 'video', title: '视频壁纸', file: 'clip.mp4' }));
  fs.writeFileSync(path.join(v, 'clip.mp4'), 'x');
  fs.writeFileSync(path.join(v, 'preview.jpg'), 'x');
  // 场景壁纸（带动图预览）
  const s = path.join(ws, '2222');
  fs.mkdirSync(s, { recursive: true });
  fs.writeFileSync(path.join(s, 'project.json'), JSON.stringify({ type: 'Scene', title: '场景壁纸', file: 'scene.json' }));
  fs.writeFileSync(path.join(s, 'scene.pkg'), 'x');
  fs.writeFileSync(path.join(s, 'preview.gif'), 'x');
  // 网页壁纸
  const w = path.join(ws, '3333');
  fs.mkdirSync(w, { recursive: true });
  fs.writeFileSync(path.join(w, 'project.json'), JSON.stringify({ type: 'web', title: '网页壁纸', file: 'index.html' }));
  fs.writeFileSync(path.join(w, 'index.html'), '<html></html>');
  // 默认工程
  const d = path.join(root, 'steamapps', 'common', 'wallpaper_engine', 'projects', 'defaultprojects', 'beach');
  fs.mkdirSync(d, { recursive: true });
  fs.writeFileSync(path.join(d, 'project.json'), JSON.stringify({ type: 'scene', title: 'Beach', file: 'scene.json' }));
  fs.writeFileSync(path.join(d, 'preview.jpg'), 'x');
  // libraryfolders.vdf 指向另一个“库”
  const lib2 = path.join(root, 'lib2');
  fs.mkdirSync(path.join(lib2, 'steamapps'), { recursive: true });
  fs.writeFileSync(
    path.join(root, 'steamapps', 'libraryfolders.vdf'),
    '"libraryfolders"\n{\n\t"0"\n\t{\n\t\t"path"\t\t"' + root.replace(/\\/g, '\\\\') + '"\n\t}\n\t"1"\n\t{\n\t\t"path"\t\t"' + lib2.replace(/\\/g, '\\\\') + '"\n\t}\n}\n'
  );
  return { root, lib2 };
}

console.log('— 合成库解析 —');
{
  const { root, lib2 } = makeFixture();
  const libs = we.findSteamLibraries({ roots: [root] });
  check('从 libraryfolders.vdf 找到 2 个库', libs.length === 2, JSON.stringify(libs));
  check('第二个库路径正确', libs.some((p) => path.resolve(p) === path.resolve(lib2)));

  const { items } = we.discoverWallpapers({ roots: [root] });
  check('共发现 4 张壁纸（3 工坊 + 1 默认）', items.length === 4, '实际 ' + items.length);
  const video = items.find((i) => i.id === '1111');
  const scene = items.find((i) => i.id === '2222');
  const web = items.find((i) => i.id === '3333');
  const def = items.find((i) => i.id === 'beach');
  check('视频型：识别为 video 且 renderable=video', video && video.type === 'video' && video.renderable === 'video');
  check('视频型：找到 mp4 路径', video && /clip\.mp4$/.test(video.video || ''));
  check('场景型：renderable=image（用动图预览）', scene && scene.renderable === 'image');
  check('场景型：preview.gif 标记为动图', scene && scene.previewAnimated === true);
  check('场景型：记录了 scene.pkg', scene && /scene\.pkg$/.test(scene.pkg || ''));
  check('网页型：type=web', web && web.type === 'web');
  check('默认工程：source=default 且有标题', def && def.source === 'default' && def.title === 'Beach');
  check('标题解析正确', video && video.title === '视频壁纸', video && video.title);

  fs.rmSync(root, { recursive: true, force: true });
}

// ---------- 2) 真实机器扫描（有 WE 才断言） ----------
console.log('\n— 本机真实扫描 —');
{
  const { libraries, items } = we.discoverWallpapers();
  console.log('  Steam 库:', libraries.length ? libraries.join(' | ') : '（未发现）');
  if (libraries.length) {
    const byType = {};
    items.forEach((i) => { byType[i.type] = (byType[i.type] || 0) + 1; });
    const byRender = {};
    items.forEach((i) => { byRender[i.renderable] = (byRender[i.renderable] || 0) + 1; });
    console.log('  壁纸总数:', items.length, '| 类型:', JSON.stringify(byType), '| 可渲染:', JSON.stringify(byRender));
    items.slice(0, 6).forEach((i) => console.log('   ·', i.id, '[' + i.type + '/' + i.renderable + ']', i.title));
    check('发现至少 1 个 Steam 库', libraries.length >= 1);
    check('发现至少 1 张壁纸', items.length >= 1);
    check('存在可直接播放的视频壁纸', items.some((i) => i.renderable === 'video'));
    check('视频文件路径真实存在', items.filter((i) => i.video).every((i) => fs.existsSync(i.video)));
    check('预览图路径真实存在', items.filter((i) => i.preview).every((i) => fs.existsSync(i.preview)));
  } else {
    console.log('  （本机未安装 Wallpaper Engine，跳过真实扫描断言）');
  }
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);