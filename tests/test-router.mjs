// 测试桥接服务智能路由
// 场景1: 当前 key (apikey.fun 代理) → 应走 CodeBuddy
// 场景2: 强制走 Exa 兜底
console.log('=== TEST: smart routing with current (proxy) key ===');
const res = await fetch('http://127.0.0.1:3200/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'DeepSeek API documentation', numResults: 2 }),
});
const data = await res.json();
console.log('HTTP', res.status, 'results:', data.results?.length);
for (const r of (data.results ?? []).slice(0, 2)) {
  console.log('  -', r.title, '|', r.url);
}
