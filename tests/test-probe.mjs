// 直接测试 DeepSeek key 探测逻辑（复制 server.mjs 中的实现）
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const DEEPSEEK_OFFICIAL_BASE_URL = 'https://api.deepseek.com/anthropic/v1';
const CREDENTIALS_FILE = path.join(homedir(), '.dsh', '.credentials.yaml');

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

async function probeDeepSeekOfficial(apiKey) {
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
    return { status: resp.status, isOfficial: resp.status !== 401 && resp.status !== 403 };
  } catch (err) {
    return { status: 'NETWORK_ERROR', isOfficial: false, err: err.message };
  } finally {
    clearTimeout(timer);
  }
}

const key = resolveDeepSeekKey();
console.log('DEEPSEEK_API_KEY resolved:', key.length > 0, 'prefix:', key.slice(0, 12), 'len:', key.length);
const result = await probeDeepSeekOfficial(key);
console.log('Probe result:', JSON.stringify(result));
console.log('=> isOfficial:', result.isOfficial, '(should be FALSE for apikey.fun proxy key)');
