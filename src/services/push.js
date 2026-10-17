/**
 * Notificações push via serviço da Expo (https://docs.expo.dev/push-notifications/sending-notifications/).
 * Sempre "melhor esforço": falha de push nunca atrapalha a corrida, pois a oferta também vai pelo socket.
 */
const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export const isExpoToken = (token) => typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

export async function sendPush(token, { title, body, data = {} }, fetchImpl = fetch) {
  if (!isExpoToken(token)) return false;
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default', priority: 'high', channelId: 'ofertas', ttl: 30 }),
    });
    return response.ok;
  } catch (error) {
    console.warn('[push] falha ao enviar:', error.message);
    return false;
  }
}
