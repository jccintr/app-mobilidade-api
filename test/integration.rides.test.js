/**
 * Teste de ponta a ponta do ciclo da corrida (REST + Socket.IO) contra um MongoDB REAL.
 *
 * Só roda se TEST_MONGODB_URI estiver definido. Ele cria um banco temporário (nome aleatório
 * "mobilidade_test_xxxx") e APAGA esse banco no final. Nunca aponte para o banco de produção.
 *
 *   TEST_MONGODB_URI="mongodb://mongo:SENHA@host:porta/?authSource=admin" npm test
 *   (ou ponha a linha TEST_MONGODB_URI=... no .env)
 */
import 'dotenv/config'; // lê TEST_MONGODB_URI do .env
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';

const uri = process.env.TEST_MONGODB_URI;

test('ciclo completo da corrida (banco real)', { skip: !uri && 'defina TEST_MONGODB_URI para rodar', timeout: 90_000 }, async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'x'.repeat(48);
  process.env.OFFER_SECONDS = '6';
  process.env.DISPATCH_SEARCH_SECONDS = '30';

  const { default: mongoose } = await import('mongoose');
  const { io: connectClient } = await import('socket.io-client');
  const { createApp } = await import('../src/app.js');
  const { initRealtime } = await import('../src/realtime/socket.js');
  const { startDispatchSweeper, clearDispatchTimers } = await import('../src/rides/dispatch.js');
  const { signToken } = await import('../src/utils/tokens.js');
  const { Tenant } = await import('../src/models/Tenant.js');
  const { Passenger } = await import('../src/models/Passenger.js');
  const { Driver } = await import('../src/models/Driver.js');
  const { Ride } = await import('../src/models/Ride.js');
  const { PricingRule } = await import('../src/models/PricingRule.js');
  const { exampleRule } = await import('../src/pricing/exampleRule.js');
  const { pricingConfigSchema } = await import('../src/pricing/schema.js');

  const dbName = `mobilidade_test_${crypto.randomBytes(4).toString('hex')}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });
  await Promise.all([Tenant, Passenger, Driver, Ride, PricingRule].map((model) => model.init()));

  const server = createServer(createApp());
  const io = initRealtime(server);
  const stopSweeper = startDispatchSweeper({ intervalMs: 1000 });
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const sockets = [];

  t.after(async () => {
    stopSweeper();
    clearDispatchTimers();
    sockets.forEach((socket) => socket.close());
    await new Promise((resolve) => setTimeout(resolve, 500)); // deixa terminar o que estava em andamento
    io.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const api = async (method, path, { token, tenant = 'teste', body } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'X-Tenant': tenant,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const waitFor = async (fn, label, ms = 15_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await fn();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.fail(`tempo esgotado esperando: ${label}`);
  };
  const connect = (token, tenant = 'teste') => {
    const socket = connectClient(base, { auth: { token, tenant }, transports: ['websocket'], reconnection: false });
    const events = [];
    for (const name of ['ride:offer', 'ride:update', 'ride:driver-location', 'chat:message']) {
      socket.on(name, (payload) => events.push({ name, payload }));
    }
    sockets.push(socket);
    return { socket, events, ready: new Promise((resolve, reject) => { socket.on('connect', resolve); socket.on('connect_error', reject); }) };
  };

  // ---- cenário ----
  const tenant = await Tenant.create({ name: 'Teste', slug: 'teste' });
  const other = await Tenant.create({ name: 'Outra', slug: 'outra' });
  await PricingRule.create({ tenantId: tenant._id, name: 'Teste', version: 1, active: true, config: pricingConfigSchema.parse(exampleRule) });

  const passenger = await Passenger.create({ tenantId: tenant._id, name: 'Maria Passageira', email: 'maria@t.com', phone: '35999990000', passwordHash: 'x', emailVerified: true });
  const driver = await Driver.create({
    tenantId: tenant._id, name: 'João Motorista', email: 'joao@t.com', phone: '35988880000', passwordHash: 'x', emailVerified: true,
    status: 'approved', vehicle: { type: 'car', brand: 'Fiat', model: 'Uno', color: 'Branco', plate: 'ABC1D23', year: 2018 },
  });
  const pToken = signToken(passenger, 'passenger');
  const dToken = signToken(driver, 'driver');

  const pickup = { lat: -22.47335, lng: -45.618334, address: 'Origem' };
  const dropoff = { lat: -22.475881, lng: -45.608479, address: 'Destino' };

  await t.test('estimativa devolve as opções de veículo', async () => {
    const r = await api('POST', '/passengers/rides/estimate', { token: pToken, body: { pickup, dropoff } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.deepEqual(r.body.quotes.map((q) => q.vehicleType).sort(), ['car']);
    assert.ok(r.body.quotes[0].fare.total > 0);
  });

  await t.test('token de uma operadora não vale em outra', async () => {
    const r = await api('GET', '/passengers/me', { token: pToken, tenant: other.slug });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'TENANT_MISMATCH');
  });

  await t.test('socket sem token é recusado', async () => {
    const { ready } = connect('invalido');
    await assert.rejects(ready);
  });

  const P = connect(pToken);
  const D = connect(dToken);
  await P.ready;
  await D.ready;

  await t.test('motorista fica online e passageiro pede a corrida', async () => {
    const online = await api('PATCH', '/drivers/me/online', { token: dToken, body: { online: true, lat: pickup.lat + 0.001, lng: pickup.lng } });
    assert.equal(online.status, 200, JSON.stringify(online.body));
    assert.equal(online.body.user.online, true);
  });

  let rideId;
  await t.test('pedido cria a corrida; segundo pedido é barrado', async () => {
    const r = await api('POST', '/passengers/rides', { token: pToken, body: { pickup, dropoff, vehicleType: 'car' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal(r.body.ride.status, 'requested');
    rideId = r.body.ride.id;
    const again = await api('POST', '/passengers/rides', { token: pToken, body: { pickup, dropoff, vehicleType: 'car' } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'ACTIVE_RIDE_EXISTS');
  });

  await t.test('chat bloqueado antes do aceite', async () => {
    const r = await api('POST', `/passengers/rides/${rideId}/messages`, { token: pToken, body: { text: 'Oi' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error.code, 'CHAT_NOT_AVAILABLE');
  });

  await t.test('motorista recebe a oferta (socket e REST)', async () => {
    await waitFor(() => D.events.find((e) => e.name === 'ride:offer'), 'ride:offer no socket do motorista');
    const active = await api('GET', '/drivers/rides/active', { token: dToken });
    assert.equal(active.body.offer?.ride.id, rideId);
    assert.equal(active.body.offer.ride.passengerInfo.name, 'Maria Passageira');
    assert.equal(active.body.offer.ride.driverInfo, undefined);
  });

  await t.test('aceitar atribui o motorista e libera o chat', async () => {
    const accept = await api('POST', `/drivers/rides/${rideId}/accept`, { token: dToken });
    assert.equal(accept.status, 200, JSON.stringify(accept.body));
    assert.equal(accept.body.ride.status, 'accepted');
    await waitFor(() => P.events.find((e) => e.name === 'ride:update' && e.payload.status === 'accepted'), 'ride:update aceito no passageiro');

    const fromPassenger = await api('POST', `/passengers/rides/${rideId}/messages`, { token: pToken, body: { text: 'Estou na esquina' } });
    assert.equal(fromPassenger.status, 201, JSON.stringify(fromPassenger.body));
    const viaSocket = await new Promise((resolve) => D.socket.emit('chat:send', { rideId, text: 'Já estou chegando' }, resolve));
    assert.equal(viaSocket.ok, true, JSON.stringify(viaSocket));
    await waitFor(() => P.events.filter((e) => e.name === 'chat:message').length >= 2, 'mensagens no passageiro');
  });

  await t.test('outro motorista não consegue aceitar nem ler a corrida', async () => {
    const intruder = await Driver.create({
      tenantId: tenant._id, name: 'Intruso', email: 'x@t.com', phone: '35977770000', passwordHash: 'x', status: 'approved',
      vehicle: { type: 'car', brand: 'VW', model: 'Gol', color: 'Preto', plate: 'XYZ9A87', year: 2015 },
    });
    const token = signToken(intruder, 'driver');
    assert.equal((await api('POST', `/drivers/rides/${rideId}/accept`, { token })).status, 409);
    assert.equal((await api('GET', `/drivers/rides/${rideId}`, { token })).status, 404);
    assert.equal((await api('POST', `/drivers/rides/${rideId}/messages`, { token, body: { text: 'oi' } })).status, 404);
  });

  await t.test('posição ao vivo chega ao passageiro', async () => {
    const ack = await new Promise((resolve) => D.socket.emit('driver:location', { lat: -22.4735, lng: -45.6175, heading: 90 }, resolve));
    assert.equal(ack.ok, true, JSON.stringify(ack));
    const event = await waitFor(() => P.events.find((e) => e.name === 'ride:driver-location'), 'posição ao vivo');
    assert.equal(event.payload.rideId, rideId);
  });

  let estimateTotal;
  await t.test('chegada, início e fim (com pedágio) fecham o valor pela regra', async () => {
    estimateTotal = (await api('GET', `/passengers/rides/${rideId}`, { token: pToken })).body.ride.total;
    assert.equal((await api('POST', `/drivers/rides/${rideId}/start`, { token: dToken })).status, 409, 'não pode iniciar sem chegar');
    assert.equal((await api('POST', `/drivers/rides/${rideId}/arrive`, { token: dToken })).body.ride.status, 'arrived');
    assert.equal((await api('POST', `/drivers/rides/${rideId}/start`, { token: dToken })).body.ride.status, 'in_progress');
    assert.equal((await api('POST', `/passengers/rides/${rideId}/cancel`, { token: pToken, body: {} })).status, 409, 'em andamento não cancela');
    const done = await api('POST', `/drivers/rides/${rideId}/finish`, { token: dToken, body: { tolls: 6.5 } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    assert.equal(done.body.ride.status, 'completed');
    assert.ok(done.body.ride.total > estimateTotal, `esperava total > ${estimateTotal}, veio ${done.body.ride.total}`);
  });

  await t.test('chat fecha ao terminar, mas o histórico continua legível', async () => {
    const send = await api('POST', `/passengers/rides/${rideId}/messages`, { token: pToken, body: { text: 'Obrigada' } });
    assert.equal(send.status, 403);
    const history = await api('GET', `/passengers/rides/${rideId}/messages`, { token: pToken });
    assert.equal(history.status, 200);
    assert.equal(history.body.data.length, 2);
    assert.equal(history.body.chatOpen, false);
  });

  await t.test('avaliação: uma vez por lado, atualiza a média', async () => {
    assert.equal((await api('POST', `/passengers/rides/${rideId}/rate`, { token: pToken, body: { stars: 5, comment: 'Ótimo' } })).status, 200);
    assert.equal((await api('POST', `/passengers/rides/${rideId}/rate`, { token: pToken, body: { stars: 1 } })).status, 409);
    assert.equal((await api('POST', `/drivers/rides/${rideId}/rate`, { token: dToken, body: { stars: 4 } })).status, 200);
    const [d, p] = await Promise.all([Driver.findById(driver._id), Passenger.findById(passenger._id)]);
    assert.equal(d.ratingAvg, 5);
    assert.equal(d.ratingCount, 1);
    assert.equal(p.ratingAvg, 4);
  });

  await t.test('recusa: sem outro motorista a corrida segue buscando; passageiro cancela e pode pedir de novo', async () => {
    const created = await api('POST', '/passengers/rides', { token: pToken, body: { pickup, dropoff, vehicleType: 'car' } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const id = created.body.ride.id;
    await waitFor(async () => (await api('GET', '/drivers/rides/active', { token: dToken })).body.offer?.ride.id === id, 'nova oferta');
    assert.equal((await api('POST', `/drivers/rides/${id}/decline`, { token: dToken })).status, 200);
    const still = await api('GET', `/passengers/rides/${id}`, { token: pToken });
    assert.equal(still.body.ride.status, 'requested');
    const cancelled = await api('POST', `/passengers/rides/${id}/cancel`, { token: pToken, body: { reason: 'Desisti' } });
    assert.equal(cancelled.body.ride.status, 'cancelled');
    const next = await api('POST', '/passengers/rides', { token: pToken, body: { pickup, dropoff, vehicleType: 'car' } });
    assert.equal(next.status, 201);
    await api('POST', `/passengers/rides/${next.body.ride.id}/cancel`, { token: pToken, body: {} });
  });

  await t.test('sem motorista disponível a corrida termina como no_driver', async () => {
    await api('PATCH', '/drivers/me/online', { token: dToken, body: { online: false } });
    const created = await api('POST', '/passengers/rides', { token: pToken, body: { pickup, dropoff, vehicleType: 'car' } });
    assert.equal(created.status, 201);
    // Força o fim da janela de busca em vez de esperar DISPATCH_SEARCH_SECONDS.
    // (createdAt é imutável no Mongoose, então vai direto na coleção)
    await Ride.collection.updateOne(
      { _id: new mongoose.Types.ObjectId(created.body.ride.id) },
      { $set: { createdAt: new Date(Date.now() - 120_000) } },
    );
    const final = await waitFor(async () => {
      const r = await api('GET', `/passengers/rides/${created.body.ride.id}`, { token: pToken });
      return r.body.ride.status === 'no_driver' && r.body.ride;
    }, 'status no_driver');
    assert.equal(final.status, 'no_driver');
  });

  await t.test('admin vê as corridas e liga o modo chuva', async () => {
    const { AdminUser } = await import('../src/models/AdminUser.js');
    const admin = await AdminUser.create({ tenantId: tenant._id, role: 'operator_admin', name: 'Admin', email: 'a@t.com', passwordHash: 'x' });
    const token = signToken(admin, 'operator_admin');
    const list = await api('GET', '/admin/rides?limit=50', { token });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    assert.ok(list.body.data.length >= 3);
    const before = (await api('POST', '/passengers/rides/estimate', { token: pToken, body: { pickup, dropoff } })).body.quotes.find((q) => q.vehicleType === 'car').fare.total;
    assert.equal((await api('PUT', '/admin/conditions', { token, body: { rain: true } })).status, 200);
    const after = (await api('POST', '/passengers/rides/estimate', { token: pToken, body: { pickup, dropoff } })).body.quotes.find((q) => q.vehicleType === 'car').fare.total;
    assert.ok(after > before, `chuva deveria encarecer: ${before} -> ${after}`);
  });
  await t.test('configurações: cor, cidade e centro do mapa aparecem no endpoint público', async () => {
    const { AdminUser } = await import('../src/models/AdminUser.js');
    const admin = await AdminUser.findOne({ tenantId: tenant._id, role: 'operator_admin' });
    const token = signToken(admin, 'operator_admin');

    const before = await api('GET', '/tenant/public');
    assert.equal(before.status, 200);
    assert.equal(before.body.tenant.map, null);

    const bad = await api('PATCH', '/admin/settings', { token, body: { brand: { primaryColor: 'vermelho' } } });
    assert.equal(bad.status, 400);

    const ok = await api('PATCH', '/admin/settings', {
      token,
      body: { brand: { primaryColor: '#0055aa' }, map: { center: { lat: -21.55, lng: -45.43 }, zoom: 14 }, cities: [{ name: 'Varginha', uf: 'mg' }] },
    });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));

    const pub = await api('GET', '/tenant/public');
    assert.equal(pub.body.tenant.brand.primaryColor, '#0055aa');
    assert.deepEqual(pub.body.tenant.map, { center: { lat: -21.55, lng: -45.43 }, zoom: 14 });
    assert.equal(pub.body.tenant.cities[0].uf, 'MG');
  });
  await t.test('admin lista passageiros com contagem de corridas e filtra corridas por passageiro', async () => {
    const { AdminUser } = await import('../src/models/AdminUser.js');
    const admin = await AdminUser.findOne({ tenantId: tenant._id, role: 'operator_admin' });
    const token = signToken(admin, 'operator_admin');

    const list = await api('GET', '/admin/passengers', { token });
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const withRides = list.body.data.find((p) => p.rides.total > 0);
    assert.ok(withRides, 'algum passageiro deveria ter corridas');
    assert.equal(withRides.passwordHash, undefined);

    const rides = await api('GET', `/admin/rides?passengerId=${withRides.id}`, { token });
    assert.equal(rides.status, 200, JSON.stringify(rides.body));
    assert.equal(rides.body.total, withRides.rides.total);
    assert.ok(rides.body.data.every((r) => r.passengerId === withRides.id));
  });
});
