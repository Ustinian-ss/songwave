# 声浪 SongWave

> 🎵 **音画一体的桌面音乐播放器** —— 多平台音源 · Wallpaper Engine 壁纸背景 · 音域地形可视化 · 10 段 EQ · 桌面歌词

**声浪 SongWave** 是一个基于 **Electron + Web Audio** 的桌面音乐播放器。它把「能放歌」和「好看」这两件事做到了同一个窗口里：在线搜索播放（网易云 / QQ / 酷狗 / 酷我 / 咪咕 五平台可切换，取链失败自动跨平台换源）、本地音乐、社区音源脚本（沙箱运行，链接 / 文件 / 一键导入，多源并存与启停）、Wallpaper Engine 壁纸背景（自动扫描 Steam 壁纸库：视频壁纸直接播放、场景壁纸动图预览，含遮罩 / 模糊 / 亮度对比度饱和 / 轮播）、内置 **SongLife 音域地形可视化引擎**（13 套主题 + 音柱亚克力材质 + 色板自选两色混搭）、10 段 EQ 与混响、逐字桌面歌词、播放模式 / 进度记忆 / 倍速 / 定时停止、下载与歌单导入。

全程**离线可测**：11 套测试、270 条断言，`npm run test:all` 一键跑完（不需要网络，也不需要启动 Electron）。

> 独立新应用：自带音源解析与取链层，不依赖任何第三方播放器桌面端。

---

## 目录

- [特性总览](#特性总览)
- [快速开始](#快速开始)
- [使用指南](#使用指南)
- [快捷键](#快捷键)
- [架构](#架构)
- [目录结构](#目录结构)
- [音源脚本 ABI（可自己写音源）](#音源脚本-abi可自己写音源)
- [测试](#测试)
- [打包与发布](#打包与发布)
- [已知限制与常见问题](#已知限制与常见问题)
- [Roadmap](#roadmap)
- [许可证与声明](#许可证与声明)

---

## 特性总览

### 🎧 播放与音源

- **多平台音源切换**：网易云 / QQ音乐 / 酷狗 / 酷我 / 咪咕，搜索框下方一键切换并记忆
- **播放失败自动换源**：取链失败或播放报错时，用「歌名 + 歌手」到其它平台找同一首歌 —— 内置匹配打分（歌名归一化、歌手比对、时长差加权），实测同曲同歌手 138 分 / 异曲 18 分自动拒绝；换源结果**写回播放列表**，失败时**逐平台显示原因**（如 `换源失败：酷狗（版权限制）、酷我（版权限制）`）
- **扩展音源脚本**：沙箱加载社区 `.js` 音源脚本，支持**粘贴链接导入 / 选文件 / 文件夹批量 / 从已安装的播放器一键导入**（含压缩脚本自动解压）、**能力探测**（声明了哪些平台、支持哪些动作）、**启用 / 停用 / 删除 / 重新下载更新**、多源并存
- **本地音乐**：多选文件导入，`file://` 播放
- **下载**：流式下载（跟随重定向、进度、取消、重名自动编号、目录可设置）
- **曲库管理**：我喜欢（收藏）、播放历史、搜索历史 + 热门搜索、**导入外部歌单**（网易云 / QQ 分享链接、纯文本歌单、本地文件）

### 🎬 画面与歌词

- **Wallpaper Engine 壁纸背景**：自动扫描 Steam 壁纸库（创意工坊 `431960` + 官方默认工程）；**视频壁纸直接播放**（mp4/webm）、**场景/网页壁纸用动图预览**（preview.gif）；三种背景模式（仅可视化 / 仅壁纸 / 叠加），遮罩、模糊、亮度 / 对比度 / 饱和度、填充方式、水平翻转、视频速度、**轮播**（间隔可调）
- **壁纸模式**：独立桌面层窗口（无边框、不抢焦点、点击穿透、置底），主题与参数实时同步；不支持置底时**自动降级为沉浸模式**；`Ctrl+Alt+W` 全局兜底退出
- **沉浸模式**：可视化全屏铺满、UI 全隐藏，`Esc` / `W` 退出
- **SongLife 音域地形可视化引擎**（WebGL 优先 + Canvas 2D 回退）：48 柱频谱地形、光子、光环、鼠标波动
- **13 套色彩主题** + 参数面板：律动强度 / 响应速度 / 闪烁 / 亮度 / 俯视视角 / 色相偏移 / 鼠标波动
- **音柱材质 4 种**：玻璃 / **亚克力（磨砂）** / 实心 / 发光，并可调**材质模糊 / 透明度 / 高光强度 / 柱体圆角**
- **色彩混搭**：色板自选两色，按位置渐变混搭（光子按半径、音柱按柱位取色），并在主题列表里作为独立一档「混搭（自选两色）」——**与音柱材质互不干扰**
- **歌词**：LRC 解析（含翻译）、同步高亮、**点击歌词跳转**、**偏移调节（±0.5s，可持久化）**
- **播放详情页**：点击左下角封面进入，旋转唱片 + 大封面 + **居中大字歌词**（点击跳转）
- **桌面歌词**：沉浸 / 壁纸模式下显示；位置（上 / 下 / 左 / 右）、对齐（居中 / 左 / 右）、行数（一行 / 两行）、字号、字重、颜色、字体、描边阴影，以及**动效**（呼吸 / 逐字扫过 / 律动缩放 / 霓虹发光）
- **面板分组折叠**：每组可展开收起，状态持久化，界面不堆叠

### 🔊 声音

- **10 段均衡器**（31Hz / 62 / 125 / 250 / 500 / 1k / 2k / 4k / 8k / 16kHz，±12dB）
- **预设**：流行 / 摇滚 / 古典 / 人声增强 / 低音增强 / 电子 + 一键重置为原声
- **混响**：卷积混响（IR 合成）+ wet/dry 可调
- 开启音效会**自动切换到直连模式**（系统回环抓取的音频无法被 Web Audio 处理），并在状态栏提示

### ⏯ 播放器

- **播放模式**：顺序播放 / 列表循环 / 单曲循环 / 随机播放
- **播放进度记忆**：每首歌记住听到哪（每 5 秒 + 暂停时保存），下次续播
- **倍速播放**：1.0 / 1.25 / 1.5 / 2.0 / 0.75 / 0.5，**保持音调**
- **定时停止**：15 / 30 / 60 / 90 分钟
- 进度 / 音量 / 滚轮调音量 / 播放列表**拖拽排序** / 序号 / 来源徽标

---

## 快速开始

```bash
# 1) 克隆（或直接下载 ZIP 解压）
git clone git@github.com:Ustinian-ss/songwave.git
cd songwave

# 2) 安装依赖（electron + electron-builder，需联网，约 100MB+）
npm install

# 3) 启动
npm start
```

**离线自检（无需安装依赖、无需网络）**：

```bash
npm run test:all     # 11 套 / 270 条断言，全离线
```

> 也可直接使用 Release 里的安装包：下载 `SongWave-Setup-*.exe` 双击安装，无需 Node 环境。

### 安装慢？换镜像

```cmd
npm config set registry https://registry.npmmirror.com
set ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
npm install --no-audit --no-fund
```

> 若 Electron 二进制已存在于缓存（`%LOCALAPPDATA%\electron\Cache`），也可以 `npm install --ignore-scripts` 后手动解压到 `node_modules/electron/dist`，并把 `node_modules/electron/path.txt` 写成 `electron.exe`。

---

## 使用指南

### 1. 在线播放

1. 左侧 🔍 搜索页，下方选择音源（**网易云 / QQ / 酷狗 / 酷我 / 咪咕**）
2. 输入歌名 / 歌手 → 回车搜索 → 点结果即播放（`＋` 加入列表、`⤓` 下载）
3. 网易云走内置直链（免登录）；其它平台**取链需要音源脚本**（见下一步）

### 2. 导入音源脚本（其它平台取链的前提）

面板 ⚙ → **音源管理**：

| 方式 | 说明 |
|---|---|
| 粘贴链接 | 支持多条链接、含「密码:xxxx」的分享文本，也能直接粘贴脚本代码 |
| 选文件 | 选择本地 `.js` 音源脚本 |
| 文件夹导入 | 批量扫描目录下所有 `.js` 并逐一探测能力 |
| 从其它播放器导入 | 自动探测常见播放器的音源数据文件，**自动解压**其中压缩存储的脚本并批量导入 |

导入后会显示每个脚本**支持的平台**（如 `kw, wy, mg, tx, kg`）与动作（`musicUrl` 取链 / `search` 搜索），可**启用停用**、**删除**、**重新下载更新**。

> 大多数社区脚本是**取链型**（只提供 `musicUrl`）：搜索由内置平台接口负责，取链交给脚本，两者组合完成播放。取链失败会自动跨平台换源。

### 3. 歌单导入

播放列表页 → **📥 歌单**：

- 粘贴**分享文本 / 歌单链接**（网易云 `music.163.com/#/playlist?id=...`、QQ `y.qq.com/n/ryqq/playlist/...`）
- 或**每行一首**「歌名 - 歌手」的纯文本（播放时自动按当前音源搜索再播放）
- 或从本地 `.txt` / `.json` / `.m3u` 文件导入

### 4. 背景与壁纸

面板 ⚙ → **背景 · Wallpaper Engine**：

- 模式：**仅可视化 / 仅壁纸 / 叠加**（叠加时可调可视化不透明度）
- 列表点选壁纸（视频壁纸会循环播放，场景壁纸用动图预览）
- 参数：遮罩 / 背景模糊 / 亮度 / 对比度 / 饱和度 / 填充方式 / 视频速度 / 水平翻转 / 轮播
- 左侧 🖼 进入**壁纸模式**（桌面层）或**沉浸模式**；退出：`Ctrl+Alt+W`（全局）或再点一次该按钮

### 5. 桌面歌词

面板 ⚙ → **桌面歌词**：启用后，在沉浸 / 壁纸模式下按你设定的位置、对齐、行数、字号、字重、颜色、字体与动效显示当前歌词（两行模式会带上下一句）。

### 6. 音效

面板 ⚙ → **音效**：勾选启用 → 选预设或直接拖动 10 段 EQ → 可选混响强度。启用后可视化会自动切到直连模式。

---

## 快捷键

| 按键 | 功能 |
|---|---|
| `Space` | 播放 / 暂停 |
| `←` / `→` | 快退 / 快进 5 秒 |
| `↑` / `↓` | 音量 ±5% |
| `M` | 静音切换 |
| `N` / `P` | 下一首 / 上一首 |
| `Esc` | 关闭播放详情页 / 退出沉浸模式 |
| `W` | 退出沉浸模式 |
| `Ctrl+Alt+W` | 全局：开关壁纸层（即使壁纸层无法聚焦也有效） |

> 输入框聚焦时快捷键不生效。播放条上滚动滚轮也可调音量。

---

## 架构

```
┌─────────────────────────── 渲染层 (app/) ───────────────────────────┐
│ index.html + renderer.js   播放逻辑 / 曲库 / 歌词 / 背景 / 音效 UI    │
│ engine.js                  SongLife 可视化引擎（WebGL + Canvas 回退） │
│                            ＋ 用户音效链接口 setEffects()/getAudioContext() │
└───────────────┬─────────────────────────────────────────────────────┘
                │ contextBridge（preload.js，无 nodeIntegration）
┌───────────────▼─────────────────── 主进程 (electron/) ──────────────┐
│ main.js    窗口 / 桌面层壁纸窗 / 全局快捷键 / 下载 / 各音源 IPC      │
└───────────────┬─────────────────────────────────────────────────────┘
                │
┌───────────────▼──────────────────── 音源层 (src/) ──────────────────┐
│ sources/netease.js      网易云：搜索 / 直链 / 歌词                   │
│ sources/platforms.js    QQ / 酷狗 / 酷我 / 咪咕：搜索（保留原生 ID）  │
│ sources/source-manager.js  音源脚本仓库：导入 / 启停 / 能力探测       │
│ sources/script-runtime.js  vm 沙箱运行时（脚本 ABI 契约）            │
│ sources/script-source.js   脚本适配层：search / getPlayUrl / getLyric│
│ sources/import-sources.js  从其它播放器一键导入（含压缩脚本解压）     │
│ match.js                换源匹配打分（纯函数）                        │
│ playlist-import.js      外部歌单解析（网易 / QQ / 文本）              │
│ wallpaper-engine.js     Steam 壁纸库扫描与可渲染性判定                │
│ audio-effects.js        10 段 EQ 预设与参数归一化                     │
│ download.js             流式下载（重定向 / 进度 / 取消 / 去重命名）    │
└─────────────────────────────────────────────────────────────────────┘

音频路径：
  <audio> ──initFile──▶ MediaElementSource ──▶ 10 段 EQ ──▶ 混响 ──▶ 输出
                              └──▶ AnalyserNode ──▶ 可视化引擎
```

> 音源脚本运行在**独立的 Node vm 沙箱**中，与任何第三方播放器零耦合；沙箱提供脚本所需的 ABI（`EVENT_NAMES` / `request` / `on` / `send` / `utils` / `currentScriptInfo`），脚本无需任何修改即可运行。

---

## 目录结构

```
songwave/
├── app/                        # 渲染层
│   ├── index.html              # UI（顶部栏 / 功能栏 / 侧栏 / 播放条 / 面板 / 详情页 / 背景层）
│   ├── renderer.js             # 播放、曲库、歌词、背景、音效、音源管理、换源等全部交互逻辑
│   ├── engine.js               # SongLife 可视化引擎（含音效链接口；源自 song-life，MIT）
│   ├── style.css               # 引擎基础样式（源自 song-life）
│   ├── player.css              # 播放器布局与所有新增组件样式
│   ├── icon.png
│   └── _songlife-original-index.html   # 引擎原始演示页（参考留存）
├── electron/
│   ├── main.js                 # 主进程：窗口 / 桌面层 / IPC / 下载 / 壁纸库 / 音效预设
│   └── preload.js              # contextBridge 安全桥
├── src/                        # 主进程侧模块（纯 Node，可离线单测）
│   ├── sources/                # 音源：netease / platforms / script-* / source-manager / import-sources
│   ├── match.js                # 换源匹配打分
│   ├── playlist-import.js      # 外部歌单导入
│   ├── wallpaper-engine.js     # Wallpaper Engine 壁纸库
│   ├── audio-effects.js        # 音效参数与预设
│   └── download.js             # 下载
├── scripts/                    # 11 套离线测试 + 音源冒烟测试
├── docs/                       # 文档与截图（可放界面截图）
└── package.json
```

---

## 音源脚本 ABI（可自己写音源）

在 `src/sources/` 里加一个模块导出 `search(keywords)` 与 `getPlayUrl(item)`，然后在 `electron/main.js` 注册 IPC 即可（内置平台音源就是这样接的）。

也可以写**社区格式的音源脚本**（放进「音源管理」导入即可运行）：

```js
// 一个最小的取链型音源脚本
const { EVENT_NAMES, on, send, request } = globalThis.lx;

// 1) 声明能力：支持哪些平台、哪些动作
send(EVENT_NAMES.inited, {
  sources: {
    kw: { name: '酷我', type: 'music', actions: ['musicUrl'], qualitys: ['128k'] },
  },
});

// 2) 处理请求：返回 Promise，resolve 的内容会交给播放器
on(EVENT_NAMES.request, ({ source, action, info }) => {
  if (action !== 'musicUrl') return Promise.reject(new Error('不支持的动作'));
  const id = info.musicInfo.songmid || info.musicInfo.id;
  return new Promise((resolve, reject) => {
    request('https://example.com/api/url?id=' + id, { method: 'get' }, (err, resp, body) => {
      if (err) return reject(err);
      if (!body || body.code !== 0) return reject(new Error('取链失败'));
      resolve({ url: body.data.url });
    });
  });
});
```

| ABI | 说明 |
|---|---|
| `EVENT_NAMES` | `{ request, inited, updateAlert }` |
| `send(EVENT_NAMES.inited, caps)` | 声明 `sources`（平台 → `{ name, type, actions, qualitys }`） |
| `send(EVENT_NAMES.updateAlert, {log, updateUrl})` | 通知更新（可选） |
| `on(EVENT_NAMES.request, handler)` | 注册请求处理器，`handler({source, action, info})` 返回 Promise |
| `request(url, {method, headers, body, form, timeout}, cb)` | HTTP 请求，`cb(err, response, body)`，`response.body` 已自动解析 JSON |
| `utils` | `crypto.md5/aesEncrypt/rsaEncrypt/randomBytes`、`buffer.from/bufToString`、`zlib.inflate/deflate` |
| `currentScriptInfo` | `{ name, version, author, homepage, rawScript }`（部分脚本用它做版本校验） |

常用 `action`：`search`（`info: {keywords, page, pageSize, type}`）、`musicUrl`（`info: {musicInfo, quality}`）、`lyric`（`info: {musicInfo}`）。

---

## 测试

```bash
npm run test:all          # 全部 11 套（推荐，全离线）
```

| 测试 | 覆盖内容 | 断言数 |
|---|---|---|
| `npm run test:renderer` | 渲染层端到端（最小 DOM 桩）：搜索、播放、歌词、桌面歌词、音效、换源、主题、曲库、拖拽 | 112 |
| `npm run test:match` | 换源匹配打分与选源 | 16 |
| `npm run test:wallpaper` | 壁纸模式（含"黑屏"回归断言） | 9 |
| `npm run test:download` | 下载（本地 HTTP 服务器：真实流式下载 / 302 / 取消 / 非法地址） | 21 |
| `npm run test:platforms` | 四平台搜索响应解析（mock fetch） | 17 |
| `npm run test:we` | Wallpaper Engine 壁纸库扫描（合成库 + 真机只读） | 16 |
| `npm run test:srcmgr` | 音源仓库：导入 / 启停 / 删除 / 持久化 / 端到端取链 | 24 |
| `npm run test:importsrc` | 从其它播放器导入（含压缩脚本解压 + 真机只读） | 15 |
| `npm run test:plimp` | 外部歌单解析（分享文本 / 平台识别 / 文本歌单） | 18 |
| `npm run test:script` | 音源脚本运行时（真实脚本加载 + inited 能力声明） | 3 |
| `npm run test:fx` | 音效参数（EQ 预设 / 归一化 / 混响） | 19 |
| `npm run test:sources` | 网易音源联网冒烟测试（**需网络**） | — |

合计 **270** 条断言，全部可在无网络、无 Electron 的环境下运行。

---

## 打包与发布

```bash
npm run build:installer    # NSIS 安装版 → dist\SongWave-Setup-<version>.exe
npm run build:portable     # 便携版     → dist\SongWave-Portable-<version>.exe
npm run build:win          # 两者都出
npm run build:dir          # 只解包不打包（dist\win-unpacked，便于快速验证）
```

- 产物在 `dist/`（已在 `.gitignore` 中，**不建议把 80MB 的安装包提交进仓库**）
- 首次运行 Windows SmartScreen 可能提示「未知发布者」→ 点「更多信息 → 仍要运行」（安装包未做代码签名）
- 想发布安装包，两种方式：
  - **网页**：仓库页 → **Releases → Draft a new release** → 把 `dist\SongWave-Setup-*.exe` 拖进附件区
  - **命令行**（[GitHub CLI](https://cli.github.com/)，先 `gh auth login` 一次）：
    ```bash
    gh release create v1.0.0 dist/SongWave-Setup-1.0.0.exe \
      --title "声浪 SongWave v1.0.0" \
      --notes-file docs/release-notes-v1.0.0.md
    ```
    发行说明模板见 `docs/release-notes-v1.0.0.md`。
- 打包时若卡在下载 NSIS / winCodeSign 二进制，用镜像：
  ```cmd
  set ELECTRON_BUILDER_BINARIES_MIRROR=https://npmmirror.com/mirrors/electron-builder-binaries/
  npm run build:installer
  ```

---

## 已知限制与常见问题

| 现象 | 原因 / 处理 |
|---|---|
| 部分歌播放失败 / 自动跳下一首 | VIP / 版权受限是正常现象；开启「播放失败自动换源」后会尝试其它平台 |
| 换源也失败 | 说明所有平台都没有可播版本；状态栏会逐个平台列出失败原因 |
| 其它平台（QQ/酷狗/…）取链失败 | 需要先导入支持该平台的**音源脚本**（面板 → 音源管理） |
| 开启音效后可视化变了 | 正常：音效需要 Web Audio 直连，会从"系统回环抓取"切换为"直连模式" |
| 壁纸层没压到桌面图标下面 | Windows 上真正的"壁纸层"需要原生挂载 Explorer 的 WorkerW（Wallpaper Engine 的做法）；本项目用的是**置底窗口**方案，观感接近但不等价；可改用沉浸模式 |
| 壁纸层关不掉 | `Ctrl+Alt+W` 全局快捷键（壁纸层点击穿透、无法聚焦，因此不能靠点它） |
| 某个脚本导入后显示"不可用" | 脚本需要联网校验版本或预热时间较长；可用 `SONGWAVE_SOURCE_INIT_TIMEOUT`（毫秒）放宽等待上限 |
| 下载/搜索无反应 | 这些操作需要联网；离线时只有本地音乐与已缓存内容可用 |

---

## Roadmap

- [x] 歌词 + 翻译 + 点击跳转 + 偏移
- [x] 播放详情页（点封面进入，居中歌词）
- [x] 桌面歌词（位置 / 对齐 / 行数 / 字体 / 颜色 / 描边 / 动效）
- [x] 多平台音源切换 + 播放失败自动换源
- [x] 音源脚本导入（链接 / 文件 / 文件夹 / 从其它播放器）
- [x] Wallpaper Engine 壁纸背景 + 壁纸 / 沉浸模式
- [x] 音效：10 段 EQ + 混响
- [x] 色彩混搭（色板自选两色）+ 音柱亚克力材质
- [x] 下载 / 歌单导入 / 播放模式 / 进度记忆 / 倍速 / 定时停止
- [ ] 桌面歌词独立浮窗（脱离壁纸层，可自由拖动）
- [ ] 排行榜与歌单推荐页
- [ ] 下载增强：歌词 / 封面嵌入、命名模板、按歌单分组、并发
- [ ] 多歌单管理（收藏夹分组）与不喜欢列表
- [ ] 歌词翻译 / 罗马音 / 简繁转换
- [ ] 系统托盘、HTTP 代理、局域网同步、OpenAPI

---

## 许可证与声明

- **SongWave 本体**：MIT
- **SongLife 可视化引擎**（`app/engine.js`、`app/style.css`）：MIT，版权归 Song-Life 作者
- **社区音源脚本**：版权归各自作者，本项目仅提供运行沙箱，不分发任何脚本
- 在线音源仅供个人学习与试听，请尊重版权；**公开发布前请自行评估合规性**
- 项目不含任何绕过付费/版权保护的技术手段，所有内容均通过公开接口或用户自行导入的音源脚本获取

---

<p align="center">如果这个项目对你有帮助，欢迎 Star ⭐ 与提交 Issue</p>
