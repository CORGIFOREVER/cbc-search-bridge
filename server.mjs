/**
 * cbc-search-bridge — 本地 Exa 兼容搜索桥（智能路由：DeepSeek 官方 > CodeBuddy > Exa）
 *
 * 模拟 Exa 的 `POST /search` 端点，收到 harness 的搜索请求后按以下顺序路由：
 *   1. 若 DEEPSEEK_API_KEY 是 DeepSeek 官方 key（探测通过）→ 调 DeepSeek 官方
 *      Anthropic 兼容搜索（web_search_20250305 原生工具），转 Exa 格式返回。
 *   2. 否则 → 通过 CodeBuddy CLI（非交互 print 模式）调用 web_search 工具。
 *   3. 若 CodeBuddy 通道不可用（CLI 未登录/超时/解析失败）→ 直接调 Exa API
 *      （需 EXA_API_KEY），保证搜索始终可用。
 *
 * 这样无论用户切换模型 API 为 DeepSeek 官方还是 apikey.fun 代理，
 * 桥接服务自动识别 DEEPSEEK_API_KEY 的类型并选择对应搜索通道，对 harness 透明。
 *
 * 依赖前置：
 *   - 已全局安装 @tencent-ai/codebuddy-code 且完成 CLI 登录（codebuddy -p "hi" 可用）
 *   - Exa 兜底需 User 级环境变量 EXA_API_KEY
 *   - 官方通道的 DEEPSEEK_API_KEY 读取自 User 环境变量或 ~/.dsh/.credentials.yaml
 *
 * 启动：node server.mjs  （默认监听 127.0.0.1:3200）
 */
import { spawn, execFileSync } from 'node:child_process';
import http from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const PORT = Number(process.env.BRIDGE_PORT ?? 3200);
const HOST = '127.0.0.1';

// ── 找到 codebuddy CLI 可执行文件 ──
// 优先直接调用 node + bin/codebuddy 入口，绕开 .cmd/.ps1 包装器的引号与编码问题。
function resolveCli() {
  if (process.platform === 'win32') {
    const node = process.env.NODE || 'C:\\Program Files\\nodejs\\node.exe';
    const bin = path.join(homedir(), 'AppData', 'Roaming', 'npm', 'node_modules', '@tencent-ai', 'codebuddy-code', 'bin', 'codebuddy');
    if (existsSync(bin)) return { node, bin };
  } else {
    for (const b of ['/usr/local/bin/codebuddy', '/usr/bin/codebuddy']) {
      if (existsSync(b)) return { node: 'node', bin: b };
    }
  }
  // 回退：走 PATH
  return { node: process.env.NODE || 'node', bin: 'codebuddy' };
}

const cli = resolveCli();

// ── 通过 CodeBuddy CLI 执行一次 web search ──
function cbcSearch(query, numResults = 5, timeoutMs = 120000) {
  return new Promise((resolve, reject) => {
    const prompt = [
      '你是搜索助手。请使用 web_search 工具搜索下面的问题，并严格以 JSON 数组输出结果。',
      `搜索问题：${query}`,
      `要求：`,
      `1. 调用 web_search 工具获取真实搜索结果，不要编造。`,
      `2. 只输出一个 JSON 数组，不要输出任何其他文字、解释或 markdown 代码块标记。`,
      `3. JSON 数组每个元素包含 4 个字段：`,
      `   - "url": 结果页面 URL`,
      `   - "title": 结果标题`,
      `   - "snippet": 从搜索结果摘录的 1-2 句话简介`,
      `   - "publishedDate": 若搜索结果显示发布日期则填写 ISO 日期字符串，否则填空字符串 ""`,
      `4. 最多返回 ${numResults} 条结果。如果搜索结果少于该数量，按实际返回。`,
      `5. 如果搜索失败或没有任何结果，输出空数组 []。`,
    ].join('\n');

    const args = ['-p', prompt];
    const child = spawn(cli.node, [cli.bin, ...args], {
      cwd: homedir(),
      env: { ...process.env, CODEBUDDY_CODE_DISABLE_BACKGROUND_TASKS: '1' },
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`CodeBuddy search timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`CLI spawn failed: ${err.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

// 从 CLI 输出中提取 JSON 数组
function extractResults(stdout) {
  // 尝试整体解析
  const trimmed = stdout.trim();
  try {
    const arr = JSON.parse(trimmed);
    if (Array.isArray(arr)) return arr;
  } catch { /* 继续 */ }
  // 尝试从 ```json ... ``` 块提取
  const fenceMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const arr = JSON.parse(fenceMatch[1].trim());
      if (Array.isArray(arr)) return arr;
    } catch { /* 继续 */ }
  }
  // 尝试找到第一个 [ ... ] 块
  const firstBracket = trimmed.indexOf('[');
  const lastBracket = trimmed.lastIndexOf(']');
  if (firstBracket >= 0 && lastBracket > firstBracket) {
    try {
      const arr = JSON.parse(trimmed.slice(firstBracket, lastBracket + 1));
      if (Array.isArray(arr)) return arr;
    } catch { /* 继续 */ }
  }
  return null;
}

// 转成 Exa 响应格式
function toExaResponse(items) {
  const results = [];
  for (const it of items) {
    if (!it || typeof it !== 'object') continue;
    const url = String(it.url ?? '').trim();
    if (!url) continue;
    const title = String(it.title ?? '').trim();
    const snippet = String(it.snippet ?? '').trim();
    if (!snippet) continue;
    const entry = {
      url,
      title,
      publishedDate: String(it.publishedDate ?? '').trim(),
      highlights: [snippet],
    };
    results.push(entry);
  }
  return { results, truncated: false };
}

// ── Exa 兜底：CodeBuddy 通道失败时直接调用 Exa API ──
// 优先用进程环境；若未注入，再从 Windows User 级环境变量读取（Start-Process 启动时不会自动带持久化环境）。
function resolveExaKey() {
  if (process.env.EXA_API_KEY) return process.env.EXA_API_KEY;
  try {
    if (process.platform === 'win32') {
      return String(execFileSync('powershell', [
        '-NoProfile', '-Command',
        '[Environment]::GetEnvironmentVariable("EXA_API_KEY","User")',
      ], { encoding: 'utf8', windowsHide: true })).trim();
    }
  } catch { /* ignore */ }
  return '';
}

const EXA_API_KEY = resolveExaKey();

async function exaFallbackSearch(query, numResults, timeoutMs = 30000) {
  if (!EXA_API_KEY) {
    throw new Error('EXA_API_KEY not set, cannot fallback to Exa');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': EXA_API_KEY,
      },
      body: JSON.stringify({
        query,
        numResults,
        type: 'auto',
        contents: { highlights: { highlightsPerUrl: 1 } },
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`Exa API returned ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
    }
    const data = await resp.json();
    const results = (data.results ?? []).map((r) => ({
      url: r.url ?? '',
      title: r.title ?? '',
      publishedDate: r.publishedDate ?? '',
      highlights: Array.isArray(r.highlights) ? r.highlights : [],
    })).filter((r) => r.url && r.title);
    return { results, truncated: false };
  } finally {
    clearTimeout(timer);
  }
}

// ── DeepSeek 官方通道：探测 DEEPSEEK_API_KEY 类型并调用官方原生搜索 ──
const DEEPSEEK_OFFICIAL_BASE_URL = 'https://api.deepseek.com/anthropic/v1';
const CREDENTIALS_FILE = path.join(homedir(), '.dsh', '.credentials.yaml');
// 探测缓存：key 前缀 → 是否官方；避免每次搜索都探测
const dsProbeCache = new Map(); // { keyPrefix: { isOfficial, at } }

/** 读取 DEEPSEEK_API_KEY：进程 env → User env → ~/.dsh/.credentials.yaml */
function resolveDeepSeekKey() {
  if (process.env.DEEPSEEK_API_KEY) return process.env.DEEPSEEK_API_KEY;
  try {
    if (process.platform === 'win32') {
      const userEnv = String(execFileSync('powershell', [
        '-NoProfile', '-Command',
        '[Environment]::GetEnvironmentVariable("DEEPSEEK_API_KEY","User")',
      ], { encoding: 'utf8', windowsHide: true })).trim();
      if (userEnv) return userEnv;
    }
  } catch { /* ignore */ }
  try {
    if (existsSync(CREDENTIALS_FILE)) {
      const text = readFileSync(CREDENTIALS_FILE, 'utf8');
      const m = text.match(/^\s*DEEPSEEK_API_KEY\s*:\s*(\S+)\s*$/m);
      if (m?.[1]) return m[1].trim();
    }
  } catch { /* ignore */ }
  return '';
}

/**
 * 探测一个 key 是否为 DeepSeek 官方 key。
 * 官方端点 api.deepseek.com 会 401 拒绝 apikey.fun 代理 key。
 * 探测结果缓存 10 分钟（key 前缀一致且未过期）。
 */
async function probeDeepSeekOfficial(apiKey) {
  const prefix = apiKey.slice(0, 12);
  const cached = dsProbeCache.get(prefix);
  if (cached && Date.now() - cached.at < 10 * 60 * 1000) return cached.isOfficial;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    const resp = await fetch(`${DEEPSEEK_OFFICIAL_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        max_tokens: 1,
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
      signal: controller.signal,
    });
    const isOfficial = resp.status !== 401 && resp.status !== 403;
    dsProbeCache.set(prefix, { isOfficial, at: Date.now() });
    return isOfficial;
  } catch (err) {
    // 网络错误视为不可达 → 不算官方通道（降级到 CodeBuddy）
    dsProbeCache.set(prefix, { isOfficial: false, at: Date.now() });
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** 调 DeepSeek 官方 Anthropic 兼容搜索，返回 Exa 格式 */
async function deepSeekOfficialSearch(query, numResults, apiKey, timeoutMs = 60000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const resp = await fetch(`${DEEPSEEK_OFFICIAL_BASE_URL}/messages`, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'authorization': `Bearer ${apiKey}`,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
        'accept': 'application/json',
      },
      body: JSON.stringify({
        model: 'deepseek-v4-flash',
        max_tokens: 4096,
        messages: [{
          role: 'user',
          content: [{ type: 'text', text: `Perform a web search for the query: ${query}` }],
        }],
        tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 3 }],
      }),
      signal: controller.signal,
    });
    if (!resp.ok) {
      const detail = (await resp.text()).slice(0, 200);
      throw new Error(`DeepSeek official API returned ${resp.status}: ${detail}`);
    }
    const data = await resp.json();
    // 解析 web_search_tool_result 块 + citations 摘要
    const blocks = data.content ?? [];
    const resultBlocks = blocks.filter((b) => b.type === 'web_search_tool_result');
    if (resultBlocks.length === 0) throw new Error('DeepSeek official returned no web_search_tool_result blocks');
    const snippetMap = new Map();
    for (const b of blocks) {
      if (b.type !== 'text') continue;
      for (const cite of b.citations ?? []) {
        if (cite.url && cite.cited_text && !snippetMap.has(cite.url)) snippetMap.set(cite.url, cite.cited_text);
      }
    }
    const seen = new Set();
    const results = [];
    for (const rb of resultBlocks) {
      for (const item of rb.content ?? []) {
        if (item.type !== 'web_search_result' || !item.url || seen.has(item.url)) continue;
        seen.add(item.url);
        const snippet = snippetMap.get(item.url) ?? item.title ?? '';
        if (!snippet) continue;
        results.push({
          url: item.url,
          title: item.title ?? '',
          publishedDate: item.page_age ?? '',
          highlights: [snippet],
        });
      }
    }
    return { results, truncated: false };
  } finally {
    clearTimeout(timer);
  }
}

const server = http.createServer(async (req, res) => {
  // CORS（harness 是服务端调用，不需要，但加上无妨）
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: true, service: 'cbc-search-bridge', cli: `${cli.node} ${cli.bin}` }));
    return;
  }

  if (req.method === 'POST' && req.url === '/search') {
    let body = '';
    for await (const chunk of req) body += chunk;
    let parsed = {};
    try { parsed = JSON.parse(body || '{}'); } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Invalid JSON body' }));
      return;
    }

    const query = String(parsed.query ?? '').trim();
    if (!query) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'Missing query' }));
      return;
    }
    const numResults = Math.min(Number(parsed.numResults ?? 5) || 5, 10);
    const forceFallback = req.headers['x-force-fallback'] === '1';

    console.log(`[bridge] search: "${query}" (numResults=${numResults}${forceFallback ? ', forced-fallback' : ''})`);

    if (forceFallback) {
      // 测试钩子：跳过 CodeBuddy，直接走 Exa 兜底
      try {
        const exa = await exaFallbackSearch(query, numResults);
        console.log(`[bridge] ${exa.results.length} results via Exa (forced fallback)`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(exa));
      } catch (exaErr) {
        console.error(`[bridge] Exa fallback failed: ${exaErr.message}`);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: `Exa fallback: ${exaErr.message}` }));
      }
      return;
    }

    // 智能路由：官方 DeepSeek key → 官方通道；否则 CodeBuddy；失败 Exa 兜底
    try {
      const dsKey = resolveDeepSeekKey();
      const isOfficial = dsKey ? await probeDeepSeekOfficial(dsKey) : false;
      if (isOfficial) {
        const official = await deepSeekOfficialSearch(query, numResults, dsKey);
        console.log(`[bridge] ${official.results.length} results via DeepSeek official`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(official));
        return;
      }
    } catch (dsErr) {
      console.error(`[bridge] DeepSeek official failed (${dsErr.message}), using CodeBuddy`);
    }

    // 非官方 key → CodeBuddy 通道
    try {
      const { code, stdout, stderr } = await cbcSearch(query, numResults);
      if (code !== 0) {
        throw new Error(`CodeBuddy CLI exited with code ${code}: ${stderr.slice(0, 300)}`);
      }
      const items = extractResults(stdout);
      if (!items) {
        throw new Error('Could not parse CodeBuddy search output');
      }
      const exa = toExaResponse(items);
      console.log(`[bridge] ${exa.results.length} results via CodeBuddy`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(exa));
      return;
    } catch (cbcErr) {
      // CodeBuddy 失败 → 降级 Exa 兜底
      console.error(`[bridge] CodeBuddy failed (${cbcErr.message}), falling back to Exa`);
      try {
        const exa = await exaFallbackSearch(query, numResults);
        console.log(`[bridge] ${exa.results.length} results via Exa (fallback)`);
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(exa));
      } catch (exaErr) {
        console.error(`[bridge] Exa fallback also failed: ${exaErr.message}`);
        res.writeHead(502, { 'content-type': 'application/json' });
        res.end(JSON.stringify({
          error: `DeepSeek official / CodeBuddy: ${cbcErr.message} | Exa fallback: ${exaErr.message}`,
        }));
      }
    }
    return;
  }

  res.writeHead(404, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(PORT, HOST, () => {
  console.log(`cbc-search-bridge listening on http://${HOST}:${PORT}`);
  console.log(`CLI: ${cli.node} ${cli.bin}`);
});
