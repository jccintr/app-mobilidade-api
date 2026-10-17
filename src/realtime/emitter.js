/**
 * Ponte entre os serviços e o Socket.IO. Sem servidor iniciado (testes, scripts) vira "não faz nada".
 */
let io = null;

export function setIo(instance) {
  io = instance;
}

export const rooms = {
  passenger: (tenantId, id) => `t:${tenantId}:p:${id}`,
  driver: (tenantId, id) => `t:${tenantId}:d:${id}`,
  admin: (tenantId) => `t:${tenantId}:admin`,
};

export function emit(room, event, payload) {
  io?.to(room).emit(event, payload);
}
