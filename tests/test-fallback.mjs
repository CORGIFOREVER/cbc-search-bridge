// 测试桥接服务：正常链路 + 模拟 CodeBuddy 失败时 Exa 兜底

// 1. 正常链路（CodeBuddy 通道）
console.log('=== TEST 1: normal path via CodeBuddy ===');
try {
  const res = await fetch('http://127.0.0.1:3200/search', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query: 'Harness AI coding agent', numResults: 2 }),
  });
  const data = await res.json();
  console.log('HTTP', res.status, 'results:', data.results?.length);
  for (const r of (data.results ?? []).slice(0, 2)) {
    console.log('  -', r.title, '|', r.url);
  }
} catch (e) {
  console.log('ERROR:', e.message);
}

// 2. 测试 Exa 兜底函数本身（直接调用 Exa API 验证 key 有效）
console.log('=== TEST 2: Exa fallback direct ===');
const exaKey = process.env.EXA_API_KEY || '';
console.log('EXA_API_KEY set:', exaKey.length > 0);
if (exaKey) {
  try {
    const resp = await fetch('https://api.exa.ai/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': exaKey },
      body: JSON.stringify({ query: 'test search', numResults: 1, type: 'auto', contents: { highlights: { highlightsPerUrl: 1 } } }),
    });
    const data = await resp.json();
    console.log('Exa HTTP', resp.status, 'results:', data.results?.length);
    if (data.results?.[0]) console.log('  -', data.results[0].title, '|', data.results[0].url);
  } catch (e) {
    console.log('Exa ERROR:', e.message);
  }
}
