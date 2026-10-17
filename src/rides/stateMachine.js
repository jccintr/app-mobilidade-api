/**
 * Máquina de estados da corrida (funções puras, sem banco).
 *
 *  requested ──accept(driver)──▶ accepted ──arrive(driver)──▶ arrived ──start(driver)──▶ in_progress ──finish(driver)──▶ completed
 *      │                            │                            │
 *      ├─cancel(passenger)          ├─cancel(passenger|driver)   ├─cancel(passenger|driver)
 *      └─expire(system)▶ no_driver  └────────▶ cancelled         └────────▶ cancelled
 *
 * Corrida em andamento (in_progress) não pode ser cancelada pelos apps.
 */
export const RIDE_STATUSES = ['requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled', 'no_driver'];

/** Corrida "viva": ocupa passageiro e motorista. */
export const ACTIVE_STATUSES = ['requested', 'accepted', 'arrived', 'in_progress'];
/** Com motorista definido e a corrida ainda não encerrada. */
export const ASSIGNED_STATUSES = ['accepted', 'arrived', 'in_progress'];
/** Chat só existe enquanto há um motorista atribuído e a corrida está rolando. */
export const CHAT_STATUSES = ASSIGNED_STATUSES;

const TRANSITIONS = {
  accept: { from: ['requested'], to: 'accepted', actors: ['driver'] },
  arrive: { from: ['accepted'], to: 'arrived', actors: ['driver'] },
  start: { from: ['arrived'], to: 'in_progress', actors: ['driver'] },
  finish: { from: ['in_progress'], to: 'completed', actors: ['driver'] },
  cancel: { from: ['requested', 'accepted', 'arrived'], to: 'cancelled', actors: ['passenger', 'driver'] },
  expire: { from: ['requested'], to: 'no_driver', actors: ['system'] },
};

/** Motorista só pode cancelar depois de aceitar (antes disso ele apenas recusa a oferta). */
const CANCEL_RESTRICTIONS = { driver: ['accepted', 'arrived'], passenger: ['requested', 'accepted', 'arrived'] };

export function transitionFor(action) {
  return TRANSITIONS[action];
}

/**
 * Retorna { ok: true, to } ou { ok: false, reason } com um motivo em português para a resposta da API.
 */
export function checkTransition(action, from, actor) {
  const rule = TRANSITIONS[action];
  if (!rule) return { ok: false, reason: 'UNKNOWN_ACTION' };
  if (!rule.actors.includes(actor)) return { ok: false, reason: 'ACTOR_NOT_ALLOWED' };
  if (!rule.from.includes(from)) return { ok: false, reason: 'INVALID_STATE' };
  if (action === 'cancel' && !CANCEL_RESTRICTIONS[actor].includes(from)) {
    return { ok: false, reason: 'INVALID_STATE' };
  }
  return { ok: true, to: rule.to };
}

export const canChat = (status) => CHAT_STATUSES.includes(status);

export const isFinal = (status) => ['completed', 'cancelled', 'no_driver'].includes(status);

/** Avaliação só depois de concluída. */
export const canRate = (status) => status === 'completed';
