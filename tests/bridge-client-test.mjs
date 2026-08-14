// 模拟 harness 用 Node 发请求给桥接服务,避免 PowerShell 编码干扰
const body = JSON.stringify({
  query: 'DeepSeek API 官方文档',
  numResults: 3,
});
const res = await fetch('http://127.0.0.1:3200/search', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body,
});
const data = await res.json();
console.log('HTTP', res.status);
console.log(JSON.stringify(data, null, 2).slice(0, 2000));
