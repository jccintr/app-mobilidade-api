import { DOCUMENT_TYPES } from '../../models/Driver.js';

/** Documentos exigidos para o cadastro do motorista ficar completo. */
export const REQUIRED_DOCS = DOCUMENT_TYPES;

export function isProfileComplete(driver) {
  const vehicle = driver.vehicle ?? {};
  const vehicleOk = Boolean(vehicle.type && vehicle.brand && vehicle.model && vehicle.color && vehicle.plate && vehicle.year);
  const docsOk = REQUIRED_DOCS.every((type) => Boolean(driver.documents?.[type]?.key));
  return vehicleOk && docsOk;
}

/**
 * Regra de transição do status do motorista quando ele envia/atualiza dados.
 *  - blocked fica blocked.
 *  - Cadastro incompleto -> 'incomplete' (a menos que já estivesse aprovado).
 *  - Completo: vai para análise ('pending_approval') ou direto 'approved' se a operadora não exige aprovação.
 *  - Aprovado que troca placa/tipo de veículo ou documento volta para análise.
 *  - Reprovado que reenvia dados volta para análise.
 */
export function nextDriverStatus({ current, complete, requireApproval, materialChange }) {
  if (current === 'blocked') return 'blocked';
  if (!complete) return current === 'approved' ? 'approved' : 'incomplete';
  if (current === 'approved') return materialChange && requireApproval ? 'pending_approval' : 'approved';
  return requireApproval ? 'pending_approval' : 'approved';
}

/** Aplica a transição no documento do motorista (sem salvar). */
export function applyDriverStatus(driver, tenant, { materialChange = false } = {}) {
  const requireApproval = tenant?.settings?.requireDriverApproval !== false;
  const next = nextDriverStatus({
    current: driver.status,
    complete: isProfileComplete(driver),
    requireApproval,
    materialChange,
  });

  if (next !== driver.status) {
    if (next === 'approved') driver.approvedAt = new Date();
    if (driver.status === 'approved') driver.online = false; // saiu de "aprovado": não pode ficar online
    if (driver.status === 'rejected') driver.rejectionReason = undefined; // reenviou: limpa o motivo anterior
    driver.status = next;
  }
  return driver.status;
}
