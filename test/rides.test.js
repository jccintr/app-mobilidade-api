import test from 'node:test';
import assert from 'node:assert/strict';
import { checkTransition, canChat, canRate, isFinal, RIDE_STATUSES } from '../src/rides/stateMachine.js';
import { haversineKm, toPoint, fromPoint } from '../src/utils/geo.js';
import { route } from '../src/services/routing/fake.js';

test('fluxo feliz da corrida', () => {
  assert.deepEqual(checkTransition('accept', 'requested', 'driver'), { ok: true, to: 'accepted' });
  assert.deepEqual(checkTransition('arrive', 'accepted', 'driver'), { ok: true, to: 'arrived' });
  assert.deepEqual(checkTransition('start', 'arrived', 'driver'), { ok: true, to: 'in_progress' });
  assert.deepEqual(checkTransition('finish', 'in_progress', 'driver'), { ok: true, to: 'completed' });
});

test('ninguém pula etapas', () => {
  assert.equal(checkTransition('start', 'accepted', 'driver').ok, false);
  assert.equal(checkTransition('finish', 'arrived', 'driver').ok, false);
  assert.equal(checkTransition('arrive', 'requested', 'driver').ok, false);
  assert.equal(checkTransition('accept', 'accepted', 'driver').reason, 'INVALID_STATE');
});

test('passageiro não conduz a corrida e motorista não pede', () => {
  for (const action of ['accept', 'arrive', 'start', 'finish']) {
    assert.equal(checkTransition(action, 'requested', 'passenger').reason, 'ACTOR_NOT_ALLOWED');
  }
  assert.equal(checkTransition('expire', 'requested', 'driver').reason, 'ACTOR_NOT_ALLOWED');
  assert.equal(checkTransition('expire', 'requested', 'system').ok, true);
});

test('cancelamento: passageiro até a chegada, motorista só depois de aceitar, ninguém em andamento', () => {
  for (const from of ['requested', 'accepted', 'arrived']) {
    assert.equal(checkTransition('cancel', from, 'passenger').ok, true, `passageiro em ${from}`);
  }
  assert.equal(checkTransition('cancel', 'requested', 'driver').ok, false);
  assert.equal(checkTransition('cancel', 'accepted', 'driver').ok, true);
  assert.equal(checkTransition('cancel', 'arrived', 'driver').ok, true);
  for (const actor of ['passenger', 'driver']) {
    assert.equal(checkTransition('cancel', 'in_progress', actor).ok, false);
  }
  for (const from of ['completed', 'cancelled', 'no_driver']) {
    assert.equal(checkTransition('cancel', from, 'passenger').ok, false);
  }
});

test('ação desconhecida', () => {
  assert.equal(checkTransition('teleport', 'requested', 'driver').reason, 'UNKNOWN_ACTION');
});

test('chat: só com motorista atribuído e corrida rolando', () => {
  const allowed = RIDE_STATUSES.filter(canChat);
  assert.deepEqual(allowed.sort(), ['accepted', 'arrived', 'in_progress']);
  assert.equal(canChat('requested'), false); // ninguém aceitou ainda
  assert.equal(canChat('no_driver'), false);
  assert.equal(canChat('completed'), false);
  assert.equal(canChat('cancelled'), false);
});

test('avaliação só depois de concluída; estados finais', () => {
  assert.equal(canRate('completed'), true);
  assert.equal(canRate('in_progress'), false);
  assert.equal(canRate('cancelled'), false);
  assert.deepEqual(RIDE_STATUSES.filter(isFinal).sort(), ['cancelled', 'completed', 'no_driver']);
});

test('distância em linha reta', () => {
  assert.ok(haversineKm({ lat: 0, lng: 0 }, { lat: 0, lng: 0 }) < 1e-9);
  // 1 grau de latitude ≈ 111,2 km
  assert.ok(Math.abs(haversineKm({ lat: 0, lng: 0 }, { lat: 1, lng: 0 }) - 111.2) < 0.3);
  // Pouso Alegre -> Cambuí (aprox.)
  const d = haversineKm({ lat: -22.2300, lng: -45.9390 }, { lat: -22.6130, lng: -46.0560 });
  assert.ok(d > 40 && d < 48, `distância inesperada: ${d}`);
});

test('GeoJSON usa [longitude, latitude]', () => {
  const point = toPoint({ lat: -22.5, lng: -45.6 });
  assert.deepEqual(point, { type: 'Point', coordinates: [-45.6, -22.5] });
  assert.deepEqual(fromPoint(point), { lat: -22.5, lng: -45.6 });
});

test('rota fake: mínimo de 1 minuto e valores coerentes', async () => {
  const same = await route({ lat: -22.47, lng: -45.61 }, { lat: -22.47, lng: -45.61 });
  assert.equal(same.distanceKm, 0);
  assert.equal(same.durationMin, 1);
  const far = await route({ lat: -22.47335, lng: -45.618334 }, { lat: -22.475881, lng: -45.608479 });
  assert.ok(far.distanceKm > 1 && far.distanceKm < 2.5, `km: ${far.distanceKm}`);
  assert.ok(far.durationMin >= 2);
});
