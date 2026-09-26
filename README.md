# 声浪 SongWave

> 音画一体的音乐播放器：**在线搜索播放 + 本地音乐 + Song-Life 可视化引擎**。
> 独立新应用：自带音源解析与取链层，不依赖任何第三方播放器桌面端。

---

## 为什么有这个项目

- **Song-Life（声命）**：惊艳的音域地形可视化（48×48 光柱网格、13 套主题），但缺曲库。
- **社区音源生态**：曲库/歌词/下载能力很强，但可视化普遍较基础，且需要长期跟随上游更新。
- **SongWave（声浪）**：把 Song-Life 引擎原样搬进一个新播放器，自建音源解析层（网易云 + QQ/酷狗/酷我/咪咕 + 扩展音源脚本），两者互不影响。

## 快速开始

```bash
cd F:\projects\songwave
npm install          # 安装 electron / electron-builder（需联网）
npm start            # 启动应用
```

> 提示：如果 `npm install` 走镜像/慢，可先设置 npm 镜像再装；应用本身不依赖任何第三方播放器。

## 功能（v0.1 MVP）

- [x] 在线搜索（网易云公开搜索接口）
- [x] 在线播放（`music.163.com/song/media/outer/url` 直链，免登录；VIP/版权受限歌曲会失败，属预期）
- [x] 本地音乐导入（多选文件，file:// 播放）
- [x] 播放列表（增删、上/下一首、自动连播、本地持久化）
- [x] 播放控制条（播放/暂停、进度、音量；滚轮调音量、键盘快捷键）
- [x] 键盘快捷键：`Space` 播放/暂停、`←/→` 快退/快进 5 秒、`↑/↓` 音量、`M` 静音、`N/P` 下一首/上一首（输入框聚焦时不响应）
- [x] 歌词显示（原词 + 翻译，随播放进度高亮）
- [x] 扩展音源状态提示（侧栏底部显示网易云 + 自定义音源加载情况）
- [x] Song-Life 可视化引擎（WebGL 优先 + Canvas 回退）
- [x] 13 套主题 + 参数面板（律动/响应/闪烁/亮度/视角/色相/鼠标波动/音柱材质）
- [x] 扩展音源脚本接入（flower.js / sixyin.js 可离线加载；flower 的 kw/tx/wy/kg/mg 取链已验证）
- [x] 下载功能（流式下载、进度显示、重定向跟随、取消、重名自动编号；目录可在侧栏设置）
- [x] **壁纸模式**（模仿 Wallpaper Engine：独立桌面层窗口，无边框、不抢焦点、点击穿透、置底，主题与参数实时同步，Esc 退出）
- [x] **多平台音源切换**（网易云 / QQ / 酷狗 / 酷我 / 咪咕；搜索走平台接口，取链走 扩展音源脚本）
- [x] **Wallpaper Engine 壁纸背景**（自动扫描 Steam 壁纸库：创意工坊 + 默认工程；视频壁纸直接播放、场景壁纸用动图预览；遮罩/模糊/亮度对比度饱和/填充/翻转/轮播）
- [ ] 桌面歌词浮窗（下一版）
- [ ] 更多取链源 / 六音搜索源（需联网验证）

## 目录结构

```
songwave/
├── app/                 # 渲染层
│   ├── index.html       # 播放器 UI（搜索/列表/控制条/可视化面板）
│   ├── renderer.js      # 播放逻辑
│   ├── engine.js        # Song-Life 引擎（来自 song-life，MIT，原样拷贝）
│   ├── style.css        # Song-Life 基础样式（原样拷贝）
│   ├── player.css       # 播放器布局覆盖
│   └── icon.png
├── electron/
│   ├── main.js          # 主进程：窗口 + IPC（搜索/直链/本地文件）
│   └── preload.js       # 安全桥
├── src/sources/         # 音源层（Node，可插拔）
│   ├── netease.js       # 网易云：search() / getPlayUrl() / getLyric()
│   ├── script-runtime.js    # 音源脚本 mini-runtime（vm 沙箱 + 脚本 ABI 契约）
│   └── script-source.js     # 扩展音源适配层：search() / getPlayUrl() / getLyric()
├── scripts/
│   ├── test-renderer.js # 渲染层离线端到端测试（npm test）
│   ├── test-sources.js  # 网易音源冒烟测试（需联网）
│   └── test-script-runtime.js # 扩展音源脚本离线测试（无需网络）
└── docs/
```

## 架构

```
渲染层 (index.html + renderer.js)
   │  搜索/直链/本地文件
   ▼
preload (contextBridge)
   ▼
主进程 (electron/main.js)
   ▼
音源层
 ├─ src/sources/netease.js ──HTTP──▶ music.163.com
 └─ src/sources/script-runtime.js + script-source.js
      └─ vm 沙箱加载社区音源脚本（.js，声明能力 + 取链）
           └─ 脚本自身通过 ABI 的 request 访问其聚合服务器
   │
渲染层 audio <audio> ──▶ engine.initFile(audio) ──▶ AnalyserNode ──▶ 可视化引擎
```

> 说明：音源脚本在**独立的 Node vm 沙箱**中运行，与任何第三方播放器零耦合；
> 声浪自带脚本 ABI 契约（`EVENT_NAMES`/`request`/`on`/`send`/`utils`），脚本不需要任何修改。

## 测试

```bash
npm test               # 渲染层离线端到端测试（最小 DOM 桩，无需 Electron/网络）
npm run test:sources   # 网易音源冒烟测试（需联网，验证网易云接口）
npm run test:script        # 扩展音源脚本离线测试（无需网络，默认 flower.js）
```

## 新增音源

### 常规音源（如 QQ/酷狗）
在 `src/sources/` 下新建 `xxx.js`，导出 `search(keywords)` 与 `getPlayUrl(id)`，再到 `electron/main.js` 里注册 IPC 即可。

### 社区音源脚本（零改造接入）
主进程默认加载 `D:\小程序\lxmusic\flower-v1.0.0.js`（可用环境变量 `SONGWAVE_SOURCE_SCRIPT` 换成 sixyin 等其他脚本）。这些脚本在 `src/sources/script-runtime.js` 的 vm 沙箱中按社区音源脚本 ABI 契约运行：脚本照常 `send(EVENT_NAMES.inited, ...)` 声明音源能力、`on(EVENT_NAMES.request, handler)` 处理请求，声浪自动接入搜索/取链/歌词。

```bash
SONGWAVE_SOURCE_SCRIPT="D:\小程序\lxmusic\sixyin-music-source-v1.1.0.js" npm start
```

> 注意：
> - flower.js / sixyin.js 均为**取链型**脚本（musicUrl，不自带搜索），需要搜索源（如内置网易云）提供待取链条目；
> - sixyin 有较长启动预热且必须联网校验版本，离线环境会加载失败（属脚本自身行为）；可用 `SONGWAVE_SOURCE_INIT_TIMEOUT`（毫秒）调整初始化等待上限，默认 30000。

## 打包

```bash
npm run build:win          # 安装版 + 便携版（产物在 dist/）
npm run build:portable     # 仅便携版
npm run build:installer    # 仅安装版
```

## 许可证与声明

- Song-Life 引擎：MIT（版权归 Song-Life 作者）
- SongWave 本体：MIT
- 在线音源仅供个人学习与试听，请尊重版权；公开发布前请自行评估合规性。

## Roadmap

- [x] 歌词 + 翻译
- [x] 扩展音源脚本接入（mini-runtime）
- [ ] 六音搜索源（sixyin）联网验证 + 多音源搜索聚合 UI
- [ ] 下载（含歌词/封面）
- [ ] 桌面歌词 / 壁纸模式（Wallpaper Engine Web 壁纸）
- [x] 音效：10 段 EQ（31Hz–16kHz）+ 混响，预设：流行/摇滚/古典/人声/低音/电子