import assert from 'node:assert/strict';
import test from 'node:test';

process.env.GOOGLE_MAPS_API_KEY = 'test-key';
const { autocomplete, details } = await import('../src/services/places.js');
const { env } = await import('../src/config/env.js');
env.rides.googleMapsApiKey = 'test-key';

const json = (data, ok = true) => ({ ok, status: ok ? 200 : 403, json: async () => data });

test('places: autocomplete pela API nova', async () => {
  const out = await autocomplete({ input: 'praça', lat: -22.4, lng: -45.6 }, async () =>
    json({ suggestions: [{ placePrediction: { placeId: 'p1', structuredFormat: { mainText: { text: 'Praça Central' }, secondaryText: { text: 'Pouso Alegre' } } } }] }),
  );
  assert.deepEqual(out, [{ placeId: 'p1', title: 'Praça Central', subtitle: 'Pouso Alegre' }]);
});

test('places: cai para a API clássica quando a nova não está habilitada', async () => {
  let calls = 0;
  const out = await autocomplete({ input: 'rua' }, async (url) => {
    calls++;
    if (String(url).includes('places.googleapis.com')) return json({ error: {} }, false);
    return json({ status: 'OK', predictions: [{ place_id: 'x', structured_formatting: { main_text: 'Rua A', secondary_text: 'Centro' } }] });
  });
  assert.equal(calls, 2);
  assert.equal(out[0].placeId, 'x');
});

test('places: erro das duas APIs vira PLACES_UNAVAILABLE', async () => {
  await assert.rejects(
    () => autocomplete({ input: 'rua' }, async (url) => (String(url).includes('places.googleapis.com') ? json({}, false) : json({ status: 'REQUEST_DENIED', error_message: 'API key' }))),
    (e) => e.code === 'PLACES_UNAVAILABLE',
  );
});

test('places: detalhes devolvem coordenadas e endereço', async () => {
  const p = await details({ placeId: 'p1' }, async () => json({ location: { latitude: -22.5, longitude: -45.6 }, formattedAddress: 'Rua X, 10 - Centro', displayName: { text: 'Padaria Y' } }));
  assert.equal(p.lat, -22.5);
  assert.equal(p.address, 'Padaria Y - Rua X, 10 - Centro');
});
