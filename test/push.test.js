import assert from 'node:assert/strict';
import test from 'node:test';
import { isExpoToken, sendPush } from '../src/services/push.js';

test('push: só aceita tokens da Expo', () => {
  assert.equal(isExpoToken('ExponentPushToken[abc123]'), true);
  assert.equal(isExpoToken('ExpoPushToken[abc123]'), true);
  assert.equal(isExpoToken('abc'), false);
  assert.equal(isExpoToken(undefined), false);
});

test('push: envia para a Expo e nunca lança erro', async () => {
  let sent;
  const ok = await sendPush('ExponentPushToken[x]', { title: 'a', body: 'b' }, async (url, init) => {
    sent = { url, body: JSON.parse(init.body) };
    return { ok: true };
  });
  assert.equal(ok, true);
  assert.equal(sent.body.to, 'ExponentPushToken[x]');
  assert.equal(sent.body.channelId, 'ofertas');

  const failed = await sendPush('ExponentPushToken[x]', { title: 'a', body: 'b' }, async () => {
    throw new Error('sem rede');
  });
  assert.equal(failed, false);
  assert.equal(await sendPush(null, { title: 'a', body: 'b' }), false);
});
