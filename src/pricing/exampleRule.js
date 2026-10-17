/**
 * Regra de EXEMPLO para testes, seed e para servir de modelo no painel.
 * Os valores são apenas ilustrativos: cada operadora define os seus.
 */
export const exampleRule = {
  currency: 'BRL',
  timezone: 'America/Sao_Paulo',
  vehicleTariffs: {
    car: { baseFare: 4, perKm: 2.2, perMinute: 0.35, minimumFare: 8 },
  },
  adjustments: [
    {
      id: 'night',
      label: 'Adicional noturno',
      when: { timeRange: { from: '22:00', to: '05:00' } },
      effect: { type: 'percent', value: 20 },
    },
    {
      id: 'rain',
      label: 'Adicional de chuva',
      when: { rain: true },
      effect: { type: 'percent', value: 15 },
    },
    {
      id: 'sunday',
      label: 'Adicional de domingo',
      when: { weekdays: [0] },
      effect: { type: 'percent', value: 10 },
    },
    {
      id: 'christmas',
      label: 'Adicional de feriado',
      when: { dates: ['2026-12-25'] },
      effect: { type: 'percent', value: 30 },
    },
    {
      id: 'bus-station',
      label: 'Taxa de rodoviária',
      when: { zones: ['rodoviaria'] },
      effect: { type: 'fixed', value: 3 },
    },
  ],
  extras: { waitPerMinute: 0.5, perStop: 2 },
  limits: { maxPercentTotal: 60, minPercentTotal: -50 },
  rounding: { step: 0.5, mode: 'nearest' },
};
