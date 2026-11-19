/**
 * O que cada lado enxerga da corrida.
 *  - passageiro: dados do motorista, valor e detalhamento do cálculo.
 *  - motorista: dados do passageiro e valor (sem o detalhamento nem dados internos).
 *  - admin: tudo, menos campos técnicos.
 * Telefone de nenhum dos dois é exposto: a conversa acontece pelo chat.
 */
export function serializeRide(ride, audience) {
  const json = typeof ride.toJSON === 'function' ? ride.toJSON() : { ...ride };
  json.total = Math.round(json.totalCents) / 100;
  const feeCents = json.fee?.status === 'charged' || json.fee?.status === 'pending' ? (json.fee.totalCents ?? 0) : 0;

  const { passengerRating, driverRating } = json;
  delete json.passengerRating;
  delete json.driverRating;

  if (audience === 'passenger') {
    json.myRating = passengerRating ?? null;
    delete json.offers;
    delete json.tenantId;
    delete json.ruleId;
    delete json.ruleVersion;
    delete json.passengerInfo;
    delete json.finalFare;
    json.fare = ride.finalFare ?? ride.estimate ?? null;
    delete json.estimate;
    delete json.fee; // a taxa é assunto entre operadora e motorista
  } else if (audience === 'driver') {
    json.myRating = driverRating ?? null;
    delete json.offers;
    delete json.tenantId;
    delete json.ruleId;
    delete json.ruleVersion;
    delete json.driverInfo;
    delete json.estimate;
    delete json.finalFare;
    // Taxa da operadora e quanto fica para o motorista (o pedágio é dele).
    json.fee = { totalCents: feeCents, status: json.fee?.status ?? 'none' };
    json.driverNetCents = Math.max(0, json.totalCents - feeCents);
  } else {
    json.driverNetCents = Math.max(0, json.totalCents - feeCents);
    json.passengerRating = passengerRating ?? null;
    json.driverRating = driverRating ?? null;
  }
  return json;
}
