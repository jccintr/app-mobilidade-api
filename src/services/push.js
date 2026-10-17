/**
 * Notificações push via serviço da Expo (https://docs.expo.dev/push-notifications/sending-notifications/).
 * Sempre "melhor esforço": falha de push nunca atrapalha a corrida, pois a oferta também vai pelo socket.
 */
const ENDPOINT = 'https://exp.host/--/api/v2/push/send';

export const isExpoToken = (token) => typeof token === 'string' && /^Expo(nent)?PushToken\[[^\]]+\]$/.test(token);

/**
 * `ttl` = por quantos segundos a Expo tenta entregar se o celular estiver sem sinal.
 * Ofertas de corrida valem poucos segundos; avisos (ex.: cadastro aprovado) valem por horas.
 */
export async function sendPush(token, { title, body, data = {}, ttl = 30, channelId = 'ofertas' }, fetchImpl = fetch) {
  if (!isExpoToken(token)) return false;
  try {
    const response = await fetchImpl(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ to: token, title, body, data, sound: 'default', priority: 'high', channelId, ttl }),
    });
    return response.ok;
  } catch (error) {
    console.warn('[push] falha ao enviar:', error.message);
    return false;
  }
}
