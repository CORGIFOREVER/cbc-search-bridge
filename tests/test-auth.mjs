import { unstable_v2_authenticate } from '@tencent-ai/agent-sdk';

try {
  const result = await unstable_v2_authenticate({
    environment: 'external',
    onAuthUrl: async () => { console.log('NEED_LOGIN'); }
  });
  console.log('AUTH_OK user=', result.userinfo?.userName);
} catch (e) {
  console.log('AUTH_ERROR:', e.message);
}
