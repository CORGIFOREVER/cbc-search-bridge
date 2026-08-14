// 验证强制 Exa 兜底路径仍可用
const res = await fetch('http://127.0.0.1:3200/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-force-fallback': '1' },
  body: JSON.stringify({ query: 'AWS re:Invent 2026 announcements', numResults: 2 }),
});
const data = await res.json();
console.log('HTTP', res.status, 'results:', data.results?.length);
for (const r of (data.results ?? []).slice(0, 2)) {
  console.log('  -', r.title, '|', r.url);
}
