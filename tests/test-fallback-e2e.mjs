// 端到端测试：正常路径(CodeBuddy) + 强制兜底路径(Exa)
console.log('=== TEST A: normal path (CodeBuddy) ===');
const resA = await fetch('http://127.0.0.1:3200/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ query: 'harness deepseek 使用教程', numResults: 2 }),
});
const dataA = await resA.json();
console.log('HTTP', resA.status, 'results:', dataA.results?.length);
for (const r of (dataA.results ?? [])) {
  console.log('  -', r.title, '|', r.url);
}

console.log('=== TEST B: forced fallback (Exa) ===');
const resB = await fetch('http://127.0.0.1:3200/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-force-fallback': '1' },
  body: JSON.stringify({ query: 'OpenAI API latest models', numResults: 2 }),
});
const dataB = await resB.json();
console.log('HTTP', resB.status, 'results:', dataB.results?.length);
for (const r of (dataB.results ?? [])) {
  console.log('  -', r.title, '|', r.url);
}
