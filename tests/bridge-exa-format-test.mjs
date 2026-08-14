// 模拟 harness 发起的完整 Exa 格式请求
const body = JSON.stringify({
  query: 'OpenAI 最新发布',
  type: 'auto',
  contents: { highlights: { highlightsPerUrl: 1 } },
  numResults: 3,
});
const res = await fetch('http://127.0.0.1:3200/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});
const data = await res.json();
console.log('HTTP', res.status);
console.log('RESULTS_COUNT', data.results?.length);
for (const r of (data.results ?? []).slice(0, 3)) {
  console.log('-', r.title, '|', r.url);
  console.log('  snippet:', (r.highlights ?? [])[0]?.slice(0, 80));
}
