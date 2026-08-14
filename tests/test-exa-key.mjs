// 模拟桥接服务的 resolveExaKey 逻辑，验证能从 User 级环境变量读到 key
import { execFileSync } from 'node:child_process';

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

const key = resolveExaKey();
console.log('EXA_API_KEY resolved:', key.length > 0, 'prefix:', key.slice(0, 6));

// 用该 key 直接测 Exa API
if (key) {
  const resp = await fetch('https://api.exa.ai/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': key },
    body: JSON.stringify({ query: 'test search', numResults: 1, type: 'auto' }),
  });
  const data = await resp.json();
  console.log('Exa HTTP', resp.status, 'results:', data.results?.length);
  if (data.results?.[0]) console.log('first:', data.results[0].title, '|', data.results[0].url);
}
