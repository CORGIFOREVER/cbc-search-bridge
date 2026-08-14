// 完整验证桥接服务：正常路径搜索
console.log('=== Bridge search (CodeBuddy path) ===');
const res = await fetch('http://127.0.0.1:3200/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'AWS re:Invent 2026 announcements', numResults: 3 }),
});
const data = await res.json();
console.log('HTTP', res.status, 'results:', data.results?.length);
for (const r of (data.results ?? [])) {
  console.log('  -', r.title, '|', r.url);
  console.log('    snippet:', (r.highlights ?? [])[0]?.slice(0, 60));
}

// health 检查
const health = await fetch('http://127.0.0.1:3200/health');
console.log('HEALTH', JSON.stringify(await health.json()));
