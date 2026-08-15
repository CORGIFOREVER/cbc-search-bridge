/**
 * @dsh-external/dsh-web-search-resilient
 *
 * 工具层“铁打”联网搜索 provider：
 *   1. 先探测 cbc-search-bridge (:3200) health
 *   2. 桥接活着 → 走桥接（桥接内部还有 CodeBuddy → Bing → Exa）
 *   3. 桥接挂了  → provider 自己用 Shell curl 抓 Bing 并返回结果
 *   4. Bing 也挂 → 如果有 EXA_API_KEY，最后直连 Exa API
 *
 * 这样即使 cbc-search-bridge 进程本身崩溃，模型侧 `web_search` 工具也不会
 * 在 HTTP 层直接失败——兜底逻辑在 DSH 进程内（provider 层）自动完成，
 * 不再依赖模型按 AGENTS.md 手动 curl Bing。
 */
import { spawn } from 'node:child_process';
import { WebError } from '@deepseek-ai/dsh-web';
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment';
import z from '@deepseek-ai/schemastery';

const name = 'web-search-resilient';
const inject = ['web'];

const BING_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

const Config = z.object({
  bridgeBaseURL: z.string().default('http://127.0.0.1:3200'),
  apiKey: z.string().default('local-bridge'),
  /** 注册后立即把运行中的 ctx.web.searchProviderId 切到 resilient（免重启生效） */
  active: z.boolean().default(true),
  numResults: z.number().min(1).max(10).default(5),
  bridgeHealthTimeoutMs: z.number().min(500).default(3000),
  bridgeSearchTimeoutMs: z.number().min(1000).default(60000),
  bingTimeoutMs: z.number().min(1000).default(20000),
  exaBaseURL: z.string().default('https://api.exa.ai'),
  exaApiKey: z.string().default(''),
});

function decodeHtmlEntities(str) {
  return str
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x27;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      try { return String.fromCodePoint(Number(n)); } catch { return ''; }
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      try { return String.fromCodePoint(parseInt(h, 16)); } catch { return ''; }
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function parseBingResults(html, limit) {
  const results = [];
  const blocks = html.split(/<li class="b_algo"/i).slice(1);
  for (const block of blocks) {
    const end = block.indexOf('</li>');
    const chunk = end >= 0 ? block.slice(0, end) : block;
    const hrefMatch = chunk.match(/<a[^>]+href="([^"]+)"[^>]*>/i);
    if (!hrefMatch) continue;
    const url = hrefMatch[1].trim();
    if (!url || /^javascript:/i.test(url)) continue;
    const titleMatch = chunk.match(/<h2[^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? decodeHtmlEntities(titleMatch[1]) : '';
    const pMatch = chunk.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const snippet = pMatch ? decodeHtmlEntities(pMatch[1]) : '';
    if (!title || !snippet) continue;
    results.push({ url, title, snippet, publishedDate: '' });
    if (results.length >= limit) break;
  }
  return results;
}

function bingSearch(query, numResults, timeoutMs) {
  return new Promise((resolve, reject) => {
    const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&count=${Math.min(numResults, 10)}`;
    const args = ['-s', '-L', '--max-time', String(Math.floor(timeoutMs / 1000)), '-A', BING_UA, url];
    const child = spawn('curl', args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Bing search timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (err) => { clearTimeout(timer); reject(new Error(`curl spawn failed: ${err.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`curl exited with code ${code}: ${stderr.slice(0, 300)}`));
      if (!stdout.trim()) return reject(new Error('curl returned empty HTML'));
      resolve(stdout);
    });
  });
}

function mapExaResult(result) {
  const snippet = result.highlights?.find((highlight) => highlight.trim().length > 0);
  if (snippet === void 0) return void 0;
  return {
    url: result.url,
    ...(result.title != null && result.title.length > 0 ? { title: result.title } : {}),
    snippet,
    ...(result.publishedDate != null && result.publishedDate.length > 0 ? { publishedAt: result.publishedDate } : {}),
  };
}

function mapExaResponse(response) {
  return {
    sources: (response.results ?? []).map(mapExaResult).filter((source) => source !== void 0),
    truncated: false,
  };
}

class ResilientSearchProvider {
  constructor(options) {
    this.options = options;
  }

  get id() {
    return 'resilient';
  }

  available() {
    return true;
  }

  async search(request, signal) {
    const query = request.query;
    const maxResults = request.maxResults ?? this.options.numResults;

    // 1) 桥接健康 → 走桥接（桥接内部有 CodeBuddy → Bing → Exa）
    if (await this.isBridgeHealthy(signal)) {
      try {
        return await this.searchViaBridge(query, maxResults, signal);
      } catch (err) {
        console.warn(`[dsh-web-search-resilient] bridge search failed (${err.message}); falling back to Bing`);
      }
    } else {
      console.warn('[dsh-web-search-resilient] bridge unhealthy; falling back to Bing');
    }

    // 2) 桥接不可用/失败 → provider 自己 curl Bing
    try {
      return await this.searchViaBing(query, maxResults);
    } catch (err) {
      console.warn(`[dsh-web-search-resilient] Bing fallback failed (${err.message}); trying Exa direct`);
    }

    // 3) 最后直连 Exa（可选，需要 EXA_API_KEY）
    if (this.options.exaApiKey) {
      try {
        return await this.searchViaExa(query, maxResults);
      } catch (err) {
        console.warn(`[dsh-web-search-resilient] Exa direct fallback failed (${err.message})`);
      }
    }

    throw new WebError('All web search channels failed (bridge/Bing/Exa)', 'WEB_PROVIDER_ERROR');
  }

  async isBridgeHealthy(signal) {
    const { bridgeBaseURL, bridgeHealthTimeoutMs } = this.options;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), bridgeHealthTimeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.('abort', onAbort);
    try {
      const resp = await fetch(`${bridgeBaseURL}/health`, {
        method: 'GET',
        signal: ctrl.signal,
      });
      if (!resp.ok) return false;
      const data = await resp.json();
      return data?.ok === true;
    } catch {
      return false;
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  async searchViaBridge(query, numResults, signal) {
    const { bridgeBaseURL, apiKey, bridgeSearchTimeoutMs, searchType, highlightsPerResult } = this.options;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), bridgeSearchTimeoutMs);
    const onAbort = () => ctrl.abort();
    signal?.addEventListener?.('abort', onAbort);
    try {
      const resp = await fetch(`${bridgeBaseURL}/search`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify({
          query,
          numResults,
          ...(searchType ? { type: searchType } : {}),
          contents: { highlights: { highlightsPerUrl: highlightsPerResult } },
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        let message = `bridge HTTP ${resp.status}`;
        try {
          const parsed = await resp.json();
          if (parsed?.error) message = parsed.error;
        } catch { /* ignore */ }
        throw new Error(message);
      }
      return mapExaResponse(await resp.json());
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener?.('abort', onAbort);
    }
  }

  async searchViaBing(query, numResults) {
    const html = await bingSearch(query, numResults, this.options.bingTimeoutMs);
    const items = parseBingResults(html, numResults);
    if (items.length === 0) {
      throw new Error('Bing returned no parseable b_algo results');
    }
    return {
      sources: items
        .map((it) => ({
          url: it.url,
          ...(it.title ? { title: it.title } : {}),
          snippet: it.snippet,
          ...(it.publishedDate ? { publishedAt: it.publishedDate } : {}),
        }))
        .filter((s) => s.url && s.snippet),
      truncated: false,
    };
  }

  async searchViaExa(query, numResults) {
    const { exaBaseURL, exaApiKey } = this.options;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
      const resp = await fetch(`${exaBaseURL}/search`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': exaApiKey,
        },
        body: JSON.stringify({
          query,
          numResults,
          type: 'auto',
          contents: { highlights: { highlightsPerUrl: 1 } },
        }),
        signal: ctrl.signal,
      });
      if (!resp.ok) {
        throw new Error(`Exa API returned ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      }
      return mapExaResponse(await resp.json());
    } finally {
      clearTimeout(timer);
    }
  }
}

function apply(ctx, config) {
  const exaKey = config.exaApiKey
    || launchEnvironmentOf(ctx).get('EXA_API_KEY')?.value
    || '';

  ctx.web.registerSearchProvider(new ResilientSearchProvider({
    bridgeBaseURL: config.bridgeBaseURL,
    apiKey: config.apiKey,
    numResults: config.numResults,
    bridgeHealthTimeoutMs: config.bridgeHealthTimeoutMs,
    bridgeSearchTimeoutMs: config.bridgeSearchTimeoutMs,
    bingTimeoutMs: config.bingTimeoutMs,
    exaBaseURL: config.exaBaseURL,
    exaApiKey: exaKey,
    searchType: 'auto',
    highlightsPerResult: 1,
  }));

  // 免重启生效：直接把运行中的 web seam 切到 resilient provider。
  // 持久化配置仍建议在 cordis.patch.yml 里把 web.searchProvider 设为 resilient。
  if (config.active !== false && ctx.web && 'searchProviderId' in ctx.web) {
    ctx.web.searchProviderId = 'resilient';
    console.log('[dsh-web-search-resilient] active: ctx.web.searchProviderId -> resilient');
  }
}

export { Config, ResilientSearchProvider, apply, inject, name };
