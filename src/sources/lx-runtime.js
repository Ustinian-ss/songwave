// 声浪 SongWave · LX 用户音源脚本 mini-runtime（Node 侧，纯本地）
// 目标：让 lx-music 生态的「自定义音源脚本」（如 flower.js / sixyin.js）在
// 不安装 LX Music 的情况下直接跑在 SongWave 里。
// 契约参考自 lx-music-desktop v2.12.6 的 user-api-preload.js：
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
 * 创建 lx 运行时上下文
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

  // 把 fetch 结果转成 lx 契约里的 response
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
      if (!r.ok) err = new Error('HTTP ' + r.status);
    } catch (e) {
      err = e;
    }
    if (typeof callback === 'function') callback(err, response, body);
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
      // 返回中止函数（LX 原实现返回取消函数；我们不支持真正中止，返回 no-op）
      doRequest(url, o, callback);
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
    utils: {
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
    },
    currentScriptInfo: { name: '', description: '', version: '', author: '', homepage: '', rawScript: '' },
    version: '2.0.0',
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
async function loadScript(scriptPath, options = {}) {
  const scriptPathResolved = path.resolve(scriptPath);
  const scriptText = fs.readFileSync(scriptPathResolved, 'utf8');
  const runtime = createLxRuntime(options);
  const { lx } = runtime;

  lx.currentScriptInfo = {
    name: options.name || path.basename(scriptPathResolved, path.extname(scriptPathResolved)),
    description: options.description || '',
    version: options.version || '',
    author: options.author || '',
    homepage: options.homepage || '',
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
    navigator: { userAgent: 'SongWave/0.3 (lx-runtime)' },
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

module.exports = { loadScript, createLxRuntime, EVENT_NAMES };