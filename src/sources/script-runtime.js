// 声浪 SongWave · 扩展音源脚本 mini-runtime（Node 侧，纯本地）
// 目标：让社区格式的「自定义音源脚本」在
// 不依赖任何第三方播放器的情况下直接跑在 SongWave 里。
// 契约参考社区音源脚本运行时（user-api）v2 系列：
//   lx.EVENT_NAMES = { request, inited, updateAlert }
//   lx.on(EVENT_NAMES.request, handler)         // handler(payload) 返回 Promise
//   lx.send(EVENT_NAMES.inited, capabilities)   // 声明 sources/actions/qualities
//   lx.request(url, {method,headers,body,form,formData,timeout}, callback(err, response, body))
//   response = { statusCode, statusMessage, headers, bytes, raw, body }
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const zlib = require('zlib');

const EVENT_NAMES = Object.freeze({
  request: 'request',
  inited: 'inited',
  updateAlert: 'updateAlert',
});

/**
 * 调试用：记录脚本读取了对象的哪些属性（只记录，不改变行为）
 */
function spyReads(obj, label) {
  if (process.env.SW_DEBUG_LX !== '1') return obj;
  if (!obj || (typeof obj !== 'object' && typeof obj !== 'function')) {
    console.log('   [' + label + '] 非对象: ' + JSON.stringify(obj));
    return obj;
  }
  try {
    return new Proxy(obj, {
      get(t, k) {
        const v = t[k];
        if (typeof k === 'string' && k !== 'then' && k !== 'catch') {
          console.log('   [' + label + '].' + k + ' → ' + (typeof v === 'function' ? 'function' : JSON.stringify(v).slice(0, 60)));
        }
        return v;
      },
    });
  } catch (e) { return obj; }
}
function debugWrap(obj, prefix) {
  if (process.env.SW_DEBUG_UTILS !== '1') return obj;
  return new Proxy(obj, {
    get(t, k) {
      const v = t[k];
      if (v === undefined) {
        console.log('[utils] ⚠ 脚本访问了不存在的方法: ' + prefix + String(k));
        return undefined;
      }
      if (typeof v === 'function') {
        return function (...args) {
          try { return v.apply(this, args); }
          catch (e) { console.log('[utils] ⚠ ' + prefix + String(k) + ' 调用抛错: ' + ((e && e.message) || e)); throw e; }
        };
      }
      if (v && typeof v === 'object') return debugWrap(v, prefix + String(k) + '.');
      return v;
    },
  });
}

/**
 * 创建 lx 运行时上下文（lx = 社区音源脚本 ABI 名，保持兼容）
 * @param {object} options
 * @param {object} [options.requestImpl] 覆盖网络请求：{ fetch: async (url, opts) => Response 兼容对象 }
 * @returns {{ lx: object, dispatch: (payload: object) => Promise<any>, getInited: () => object|null, onRequest: (fn) => void }}
 */
function createLxRuntime(options = {}) {
  let requestHandler = null;
  let initedData = null;
  let updateAlertData = null;
  let resolveInited = null;
  const initedPromise = new Promise((resolve) => { resolveInited = resolve; });

  // —— 网络请求（默认 Node fetch；可注入 mock） ——
  const doFetch = options.requestImpl && options.requestImpl.fetch
    ? options.requestImpl.fetch
    : async (url, opts) => {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), (opts && opts.timeout) || 15000);
        try {
          const res = await fetch(url, {
            method: (opts && opts.method) || 'GET',
            headers: (opts && opts.headers) || {},
            body: (opts && opts.body) || undefined,
            redirect: 'follow',
            signal: controller.signal,
          });
          const raw = Buffer.from(await res.arrayBuffer());
          return { ok: res.ok, status: res.status, headers: res.headers, raw, url: res.url };
        } finally {
          clearTimeout(timer);
        }
      };

  // 把 fetch 结果转成 ABI 契约里的 response
  async function doRequest(url, opts = {}, callback) {
    let err = null;
    let response = null;
    let body = null;
    try {
      const r = await doFetch(url, opts);
      const text = r.raw.toString();
      let parsed = text;
      try { parsed = JSON.parse(text); } catch (e) { /* 非 JSON 保持字符串 */ }
      const headers = {};
      if (r.headers && typeof r.headers.forEach === 'function') {
        r.headers.forEach((v, k) => { headers[k] = v; });
      } else if (r.headers && typeof r.headers === 'object') {
        Object.assign(headers, r.headers);
      }
      response = {
        statusCode: r.status,
        statusMessage: r.ok ? 'OK' : 'Error',
        headers,
        bytes: r.raw.length,
        raw: r.raw,
        body: parsed,
      };
      body = parsed;
      // 实验开关：LX 官方运行时给脚本的是原始字符串（脚本自己 JSON.parse），
      // 这里用环境变量对照验证（SW_RAW_BODY=1 传原始文本）
      if (process.env.SW_RAW_BODY === '1') {
        response.body = text;
        body = text;
      }
      if (!r.ok) err = new Error('HTTP ' + r.status);
    } catch (e) {
      err = e;
    }
    // 脚本回调里可能抛错：就地吞掉，绝不让它逃逸成未处理拒绝（会崩主进程）
    if (typeof callback === 'function') {
      try { callback(err, response, body); }
      catch (e) {
        console.log('[ext-source] 脚本回调抛错（已忽略）:', (e && e.message) || e);
      }
    }
    return err;
  }

  const lx = {
    EVENT_NAMES,
    request(url, opts, callback) {
      if (typeof opts === 'function') {
        callback = opts;
        opts = {};
      }
      const o = opts || {};
      if (o.form) {
        const body = new URLSearchParams();
        Object.entries(o.form).forEach(([k, v]) => body.append(k, v));
        o.body = body.toString();
        o.headers = { 'Content-Type': 'application/x-www-form-urlencoded', ...(o.headers || {}) };
      }
      // 调试：SW_DEBUG_LX=1 时打印脚本从 resp/body 读了哪些字段（音源脚本是混淆的，只能这样看它要什么）
      let cb = callback;
      if (process.env.SW_DEBUG_LX === '1' && typeof callback === 'function') {
        cb = (err, resp, body) => {
          console.log('[lx] 回调 err=' + (err && err.message) + ' status=' + (resp && resp.statusCode) + ' bodyType=' + (typeof body));
          spyReads(resp, 'resp');
          spyReads(body, 'body');
          return callback(err, resp, body);
        };
      }
      // 返回中止函数（LX 原实现返回取消函数；我们不支持真正中止，返回 no-op）
      doRequest(url, o, cb);
      return () => {};
    },
    send(name, data) {
      if (name === EVENT_NAMES.inited) {
        if (initedData) return Promise.reject(new Error('Script is inited'));
        initedData = data;
        resolveInited(data);
        return Promise.resolve();
      }
      if (name === EVENT_NAMES.updateAlert) {
        updateAlertData = data;
        return Promise.resolve();
      }
      return Promise.reject(new Error('The event is not supported: ' + name));
    },
    on(name, handler) {
      if (name !== EVENT_NAMES.request) {
        return Promise.reject(new Error('The event is not supported: ' + name));
      }
      requestHandler = handler;
      return Promise.resolve();
    },
    utils: debugWrap({
      crypto: {
        aesEncrypt(data, algorithm, key, iv) {
          const cipher = crypto.createCipheriv(algorithm, key, iv);
          return Buffer.concat([cipher.update(data), cipher.final()]);
        },
        rsaEncrypt(data, key) {
          const buf = Buffer.concat([Buffer.alloc(128 - data.length), data]);
          return crypto.publicEncrypt({ key, padding: crypto.constants.RSA_NO_PADDING }, buf);
        },
        randomBytes(size) { return crypto.randomBytes(size); },
        md5(data) { return crypto.createHash('md5').update(data).digest('hex'); },
      },
      buffer: {
        from: (...args) => Buffer.from(...args),
        bufToString: (buf, enc) => Buffer.from(buf, 'binary').toString(enc),
      },
      zlib: {
        inflate: (buf) => new Promise((resolve, reject) => {
          zlib.inflate(buf, (e, out) => (e ? reject(new Error(e.message)) : resolve(out)));
        }),
        deflate: (buf) => new Promise((resolve, reject) => {
          zlib.deflate(buf, (e, out) => (e ? reject(new Error(e.message)) : resolve(out)));
        }),
      },
    }, 'utils.'),
    currentScriptInfo: { name: '', description: '', version: '', author: '', homepage: '', rawScript: '' },
    // 宿主应用版本：部分音源脚本会据此选择接口版本（可用 SW_LX_VERSION 覆盖做对照实验）
    version: process.env.SW_LX_VERSION || '2.0.0',
    env: 'desktop',
  };

  return {
    lx,
    dispatch: async (payload) => {
      if (typeof requestHandler !== 'function') {
        throw new Error('音源脚本尚未注册 request 处理器');
      }
      return requestHandler(payload);
    },
    getInited: () => initedData,
    getUpdateAlert: () => updateAlertData,
    initedPromise,
  };
}

/**
 * 在 Node 沙箱里加载 LX 音源脚本（异步等待脚本的 inited 能力声明）
 * @param {string} scriptPath
 * @param {object} [options] { requestImpl, name, description, version, author, homepage, initTimeoutMs }
 * @returns {Promise<{ runtime, scriptText, sources: object, updateAlert }>}
 */
// —— 防崩护栏：脚本内部的 Promise 链可能在 .finally/.then 里抛错，
//    Node 默认会把「未处理的拒绝」升级成进程 abort。装上护栏后只记录日志，应用继续运行。
let guardsInstalled = false;
function installProcessGuards() {
  if (guardsInstalled) return;
  guardsInstalled = true;
  process.on('uncaughtException', (e) => {
    console.log('[ext-source] 未捕获异常（已忽略）:', (e && (e.stack || e.message)) || e);
  });
  process.on('unhandledRejection', (r) => {
    console.log('[ext-source] 未处理的 Promise 拒绝（已忽略）:', (r && (r.stack || r.message)) || r);
  });
}
/**
 * 从脚本头部注释里读元信息（@name/@version/@description/@author/@homepage）。
 * 重要：部分音源脚本（例如 flower/野花）会拿 currentScriptInfo.version 去校验版本，
 * 并用它作为请求头 source-ver；这个字段为空时接口会直接 404（实测过），
 * 所以必须优先用脚本**自己声明**的版本，而不是外部登记表里的。
 */
function headerMeta(scriptText) {
  const head = String(scriptText || '').slice(0, 1000);
  const grab = (re) => {
    const m = head.match(re);
    return m ? String(m[1]).trim().replace(/^["']|["']$/g, '') : '';
  };
  return {
    name: grab(/@name\s+(.+)/),
    version: grab(/@version\s+(.+)/).replace(/^v/i, ''),
    description: grab(/@description\s+(.+)/),
    author: grab(/@author\s+(.+)/),
    homepage: grab(/@homepage\s+(.+)/),
  };
}

async function loadScript(scriptPath, options = {}) {
  installProcessGuards();
  const scriptPathResolved = path.resolve(scriptPath);
  const scriptText = fs.readFileSync(scriptPathResolved, 'utf8');
  const runtime = createLxRuntime(options);
  const { lx } = runtime;

  const meta = headerMeta(scriptText);
  const baseName = path.basename(scriptPathResolved, path.extname(scriptPathResolved));
  lx.currentScriptInfo = {
    name: meta.name || options.name || baseName,
    description: meta.description || options.description || '',
    version: meta.version || options.version || '',
    author: meta.author || options.author || '',
    homepage: meta.homepage || options.homepage || '',
    rawScript: scriptText,
  };

  const sandbox = {
    lx,
    console,
    Buffer,
    setTimeout,
    clearTimeout,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    crypto,
    atob: (s) => Buffer.from(s, 'base64').toString('binary'),
    btoa: (s) => Buffer.from(s, 'binary').toString('base64'),
    navigator: { userAgent: 'SongWave/2.0 (ext-source-runtime)' },
    // 脚本常会调用这些浏览器 API：不存在的话一加载就 TypeError
    addEventListener: function () {},
    removeEventListener: function () {},
    setInterval: setInterval,
    clearInterval: clearInterval,
    document: { addEventListener: function () {}, removeEventListener: function () {}, createElement: function () { return { style: {} }; } },
    location: { href: 'about:blank', search: '' },
  };
  vm.createContext(sandbox);
  // 让脚本里 window/self/globalThis 都指向同一全局
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;
  vm.runInContext(scriptText, sandbox, { filename: scriptPathResolved });

  // 等待脚本发送 inited（部分脚本先做异步版本校验再声明）
  const timeoutMs = options.initTimeoutMs || 20000;
  const timer = new Promise((resolve) => setTimeout(resolve, timeoutMs));
  await Promise.race([runtime.initedPromise, timer]);

  const inited = runtime.getInited();
  if (!inited || !inited.sources) {
    throw new Error('音源脚本未发送 inited 能力声明（可能不是 LX v2 用户音源，或初始化超时）');
  }
  return { runtime, scriptText, sources: inited.sources, updateAlert: runtime.getUpdateAlert() };
}

module.exports = { loadScript, createLxRuntime, EVENT_NAMES, installProcessGuards };