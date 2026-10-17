import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const { directions, decodePolyline } = await import('../src/services/directions.js');
const { env } = await import('../src/config/env.js');

const json = (data, ok = true) => ({ ok, status: ok ? 200 : 403, json: async () => data });
const A = { lat: -22.47, lng: -45.61 };

test('directions: decodifica polilinha do Google', () => {
  // exemplo oficial da documentação do Google
  const pts = decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@');
  assert.equal(pts.length, 3);
  assert.deepEqual(pts[0], [38.5, -120.2]);
  assert.deepEqual(pts[2], [43.252, -126.453]);
});

test('directions: Routes API devolve pontos e passos', async () => {
  env.rides.googleMapsApiKey = 'test-key';
  const out = await directions(A, { lat: -22.48, lng: -45.62 }, async () =>
    json({
      routes: [
        {
          distanceMeters: 1500,
          duration: '240s',
          polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' },
          legs: [{ steps: [{ distanceMeters: 800, navigationInstruction: { maneuver: 'TURN_LEFT', instructions: 'Vire à esquerda na Rua A' }, endLocation: { latLng: { latitude: -22.475, longitude: -45.615 } } }] }],
        },
      ],
    }),
  );
  assert.equal(out.approximate, false);
  assert.equal(out.durationSeconds, 240);
  assert.equal(out.points.length, 2);
  assert.equal(out.steps[0].maneuver, 'TURN_LEFT');
});

test('directions: cai para a API clássica e, por fim, para linha reta', async () => {
  const to = { lat: -22.49, lng: -45.63 };
  const legacy = await directions(A, to, async (url) => {
    if (String(url).includes('routes.googleapis.com')) return json({}, false);
    return json({ status: 'OK', routes: [{ overview_polyline: { points: '_p~iF~ps|U_ulLnnqC' }, legs: [{ distance: { value: 900 }, duration: { value: 120 }, steps: [{ html_instructions: 'Vire <b>à direita</b>', maneuver: 'turn-right', distance: { value: 900 }, end_location: { lat: -22.49, lng: -45.63 } }] }] }] });
  });
  assert.equal(legacy.steps[0].instruction, 'Vire à direita');
  assert.equal(legacy.steps[0].maneuver, 'TURN_RIGHT');

  const far = { lat: -22.9, lng: -45.9 };
  const line = await directions(A, far, async () => json({}, false));
  assert.equal(line.approximate, true);
  assert.equal(line.points.length, 2);
});

test('directions: sem chave devolve linha reta sem chamar o Google', async () => {
  env.rides.googleMapsApiKey = '';
  let called = false;
  const out = await directions(A, { lat: -22.5, lng: -45.7 }, async () => { called = true; return json({}); });
  assert.equal(called, false);
  assert.equal(out.approximate, true);
  env.rides.googleMapsApiKey = 'test-key';
});
