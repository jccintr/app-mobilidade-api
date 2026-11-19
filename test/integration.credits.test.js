/**
 * Créditos do motorista e taxa da operadora, contra um MongoDB REAL.
 * Só roda se TEST_MONGODB_URI estiver definido (cria um banco temporário e apaga no final).
 *
 * Cobre: configuração (Pix), pacotes, compra via Pix ("Já paguei" → confirmação), expiração, recusa,
 * taxa descontada no aceite, devolução quando o passageiro cancela, perda quando o motorista cancela,
 * motorista sem saldo não recebe oferta, boas-vindas e ajuste manual.
 */
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';

const uri = process.env.TEST_MONGODB_URI;

test('créditos do motorista e taxa da operadora (banco real)', { skip: !uri && 'defina TEST_MONGODB_URI para rodar', timeout: 120_000 }, async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'x'.repeat(48);
  process.env.SMTP_HOST = ''; // sem SMTP: e-mails vão para o console
  process.env.OFFER_SECONDS = '5';
  process.env.DISPATCH_SEARCH_SECONDS = '30';

  const { default: mongoose } = await import('mongoose');
  const { createApp } = await import('../src/app.js');
  const { clearDispatchTimers } = await import('../src/rides/dispatch.js');
  const { signToken } = await import('../src/utils/tokens.js');
  const { Tenant } = await import('../src/models/Tenant.js');
  const { AdminUser } = await import('../src/models/AdminUser.js');
  const { Passenger } = await import('../src/models/Passenger.js');
  const { Driver } = await import('../src/models/Driver.js');
  const { Ride } = await import('../src/models/Ride.js');
  const { PricingRule } = await import('../src/models/PricingRule.js');
  const { WalletEntry } = await import('../src/models/WalletEntry.js');
  const { CreditPackage } = await import('../src/models/CreditPackage.js');
  const { CreditPurchase } = await import('../src/models/CreditPurchase.js');
  const { exampleRule } = await import('../src/pricing/exampleRule.js');
  const { pricingConfigSchema } = await import('../src/pricing/schema.js');

  const dbName = `mobilidade_test_${crypto.randomBytes(4).toString('hex')}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });
  await Promise.all([Tenant, AdminUser, Passenger, Driver, Ride, PricingRule, WalletEntry, CreditPackage, CreditPurchase].map((m) => m.init()));

  const originalLog = console.log;
  console.log = (...args) => (String(args[0]).startsWith('[mailer:dev]') ? undefined : originalLog(...args));

  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    console.log = originalLog;
    clearDispatchTimers();
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const api = async (method, path, { token, body } = {}) => {
    const response = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', 'X-Tenant': 'teste', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, body: await response.json().catch(() => null) };
  };
  const waitFor = async (fn, label, ms = 10_000) => {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const value = await fn();
      if (value) return value;
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
    assert.fail(`tempo esgotado esperando: ${label}`);
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  // ---- cenário ----
  const tenant = await Tenant.create({ name: 'Teste', slug: 'teste', brand: { displayName: 'Velo' } });
  await PricingRule.create({ tenantId: tenant._id, name: 'Teste', version: 1, active: true, config: pricingConfigSchema.parse(exampleRule) });
  const admin = await AdminUser.create({ tenantId: tenant._id, role: 'operator_admin', name: 'Admin', email: 'admin@t.com', passwordHash: 'x' });
  const passenger = await Passenger.create({ tenantId: tenant._id, name: 'Maria', email: 'maria@t.com', phone: '35999990000', passwordHash: 'x', emailVerified: true });
  const driver = await Driver.create({
    tenantId: tenant._id, name: 'João', email: 'joao@t.com', phone: '35988880000', passwordHash: 'x', emailVerified: true, status: 'approved',
    vehicle: { type: 'car', brand: 'Fiat', model: 'Uno', color: 'Branco', plate: 'ABC1D23', year: 2018 },
  });
  const aToken = signToken(admin, 'operator_admin');
  const pToken = signToken(passenger, 'passenger');
  const dToken = signToken(driver, 'driver');
  const balance = async () => (await Driver.findById(driver._id)).wallet?.balanceCents ?? 0;

  const pickup = { lat: -22.47335, lng: -45.618334, address: 'Origem' };
  const dropoff = { lat: -22.475881, lng: -45.608479, address: 'Destino' };

  await t.test('sem cobrança configurada, a compra de créditos fica indisponível', async () => {
    const wallet = await api('GET', '/drivers/me/wallet', { token: dToken });
    assert.equal(wallet.status, 200, JSON.stringify(wallet.body));
    assert.equal(wallet.body.billing.enabled, false);
    assert.equal(wallet.body.billing.pixReady, false);
  });

  await t.test('configuração: chave Pix ambígua pede o tipo; com o tipo, salva normalizada', async () => {
    const ambiguous = await api('PATCH', '/admin/settings', { token: aToken, body: { billing: { pix: { key: '35999990076' } } } });
    assert.equal(ambiguous.status, 400);
    assert.equal(ambiguous.body.error.code, 'PIX_KEY_AMBIGUOUS');

    const saved = await api('PATCH', '/admin/settings', {
      token: aToken,
      body: {
        billing: {
          feeFixedCents: 100,
          feePercent: 10,
          lowBalanceCents: 500,
          welcomeCreditCents: 1000,
          notifyEmail: 'financeiro@velo.com',
          pix: { key: '(35) 99999-1234', receiverName: 'Velo Mobilidade', city: 'Brazópolis' },
        },
      },
    });
    assert.equal(saved.status, 200, JSON.stringify(saved.body));
    assert.equal(saved.body.settings.billing.pix.key, '+5535999991234');
    assert.equal(saved.body.settings.billing.pix.keyType, 'PHONE');
    assert.equal(saved.body.settings.billing.enabled, true);
    assert.equal(saved.body.settings.billing.pixReady, true);
  });

  let packageId;
  await t.test('admin cria pacote (com bônus) e o motorista vê só os ativos', async () => {
    const bad = await api('POST', '/admin/credit-packages', { token: aToken, body: { name: 'Errado', priceCents: 5000, creditCents: 4000 } });
    assert.equal(bad.status, 400);
    const created = await api('POST', '/admin/credit-packages', { token: aToken, body: { name: 'R$ 50 + bônus', priceCents: 5000, creditCents: 5500 } });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.equal(created.body.package.bonusCents, 500);
    packageId = created.body.package.id;
    await api('POST', '/admin/credit-packages', { token: aToken, body: { name: 'Inativo', priceCents: 2000, creditCents: 2000, active: false } });
    const list = await api('GET', '/drivers/credits/packages', { token: dToken });
    assert.deepEqual(list.body.data.map((p) => p.name), ['R$ 50 + bônus']);
  });

  let purchaseId;
  await t.test('compra gera o Pix (QR + copia e cola) e só uma pode ficar em aberto', async () => {
    const r = await api('POST', '/drivers/credits/purchases', { token: dToken, body: { packageId } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const { purchase } = r.body;
    purchaseId = purchase.id;
    assert.equal(purchase.status, 'pending');
    assert.match(purchase.code, /^C[A-Z2-9]{6}$/);
    assert.ok(purchase.pixPayload.includes('540550.00'), 'valor do pacote no BR Code');
    assert.ok(purchase.pixPayload.includes(purchase.code), 'código da compra como identificador');
    assert.match(purchase.qrCodeDataUrl, /^data:image\/png;base64,/);

    const again = await api('POST', '/drivers/credits/purchases', { token: dToken, body: { packageId } });
    assert.equal(again.status, 409);
    assert.equal(again.body.error.code, 'OPEN_PURCHASE_EXISTS');
  });

  await t.test('"Já paguei" avisa a operadora, mas não libera saldo; admin confirma uma vez só', async () => {
    const informed = await api('POST', `/drivers/credits/purchases/${purchaseId}/inform`, { token: dToken, body: { payerNote: 'Paguei pelo Nubank' } });
    assert.equal(informed.status, 200, JSON.stringify(informed.body));
    assert.equal(informed.body.purchase.status, 'informed');
    assert.equal(await balance(), 0);
    assert.equal((await api('POST', `/drivers/credits/purchases/${purchaseId}/inform`, { token: dToken, body: {} })).status, 409);

    const summary = await api('GET', '/admin/credit-purchases/summary', { token: aToken });
    assert.deepEqual(summary.body, { informed: 1, pending: 0 });

    const confirmed = await api('POST', `/admin/credit-purchases/${purchaseId}/confirm`, { token: aToken });
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.body));
    assert.equal(confirmed.body.purchase.status, 'confirmed');
    assert.equal(confirmed.body.purchase.driver.name, 'João');
    assert.equal(await balance(), 5500);
    assert.equal((await api('POST', `/admin/credit-purchases/${purchaseId}/confirm`, { token: aToken })).status, 409);
    assert.equal(await balance(), 5500, 'confirmar de novo não credita duas vezes');
  });

  await t.test('compra sem "Já paguei" expira em 3 dias; recusa devolve o motivo', async () => {
    const created = await api('POST', '/drivers/credits/purchases', { token: dToken, body: { packageId } });
    await CreditPurchase.updateOne({ _id: created.body.purchase.id }, { $set: { expiresAt: new Date(Date.now() - 1000) } });
    const wallet = await api('GET', '/drivers/me/wallet', { token: dToken });
    assert.equal(wallet.body.openPurchase, null);
    const late = await api('POST', `/drivers/credits/purchases/${created.body.purchase.id}/inform`, { token: dToken, body: {} });
    assert.equal(late.status, 409);

    const next = await api('POST', '/drivers/credits/purchases', { token: dToken, body: { packageId } });
    assert.equal(next.status, 201, 'a vencida não bloqueia uma nova compra');
    const rejected = await api('POST', `/admin/credit-purchases/${next.body.purchase.id}/reject`, { token: aToken, body: { reason: 'Pix não encontrado.' } });
    assert.equal(rejected.body.purchase.status, 'rejected');
    assert.equal(rejected.body.purchase.rejectionReason, 'Pix não encontrado.');
    assert.equal(await balance(), 5500);
  });

  const requestRide = async () => {
    const r = await api('POST', '/passengers/rides', { token: pToken, body: { pickup, dropoff, vehicleType: 'car' } });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body.ride.id;
  };
  const acceptOffer = async (rideId) => {
    await waitFor(async () => (await api('GET', '/drivers/rides/active', { token: dToken })).body.offer?.ride.id === rideId, 'oferta ao motorista');
    const accept = await api('POST', `/drivers/rides/${rideId}/accept`, { token: dToken });
    assert.equal(accept.status, 200, JSON.stringify(accept.body));
    return accept.body.ride;
  };

  await t.test('motorista online recebe a oferta com a taxa e o líquido; passageiro não vê a taxa', async () => {
    const online = await api('PATCH', '/drivers/me/online', { token: dToken, body: { online: true, lat: pickup.lat + 0.001, lng: pickup.lng } });
    assert.equal(online.status, 200, JSON.stringify(online.body));
  });

  let feeCents;
  await t.test('aceite desconta a taxa; passageiro cancela e a taxa volta', async () => {
    const rideId = await requestRide();
    const stored = await Ride.findById(rideId);
    feeCents = stored.fee.totalCents;
    assert.equal(stored.fee.status, 'pending');
    assert.equal(feeCents, 100 + Math.round(stored.totalCents * 0.1));

    const passengerView = await api('GET', `/passengers/rides/${rideId}`, { token: pToken });
    assert.equal(passengerView.body.ride.fee, undefined);

    const ride = await acceptOffer(rideId);
    assert.equal(ride.fee.totalCents, feeCents);
    assert.equal(ride.driverNetCents, ride.totalCents - feeCents);
    assert.equal(await balance(), 5500 - feeCents);

    const cancel = await api('POST', `/passengers/rides/${rideId}/cancel`, { token: pToken, body: {} });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(await balance(), 5500);
    assert.equal((await Ride.findById(rideId)).fee.status, 'refunded');
    assert.deepEqual((await WalletEntry.find({ rideId }).sort({ createdAt: 1 })).map((e) => e.type), ['ride_fee', 'ride_refund']);
  });

  await t.test('motorista aceita e cancela: perde a taxa', async () => {
    const rideId = await requestRide();
    await acceptOffer(rideId);
    const cancel = await api('POST', `/drivers/rides/${rideId}/cancel`, { token: dToken, body: { reason: 'Desisti' } });
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    assert.equal(await balance(), 5500 - feeCents);
    assert.equal((await Ride.findById(rideId)).fee.status, 'charged');
  });

  await t.test('corrida concluída com pedágio: o pedágio fica com o motorista, a taxa não muda', async () => {
    const before = await balance();
    const rideId = await requestRide();
    await acceptOffer(rideId);
    await api('POST', `/drivers/rides/${rideId}/arrive`, { token: dToken });
    await api('POST', `/drivers/rides/${rideId}/start`, { token: dToken });
    const done = await api('POST', `/drivers/rides/${rideId}/finish`, { token: dToken, body: { tolls: 6.5, waitMinutes: 30 } });
    assert.equal(done.status, 200, JSON.stringify(done.body));
    const ride = done.body.ride;
    assert.equal(ride.fee.totalCents, feeCents);
    assert.equal(ride.driverNetCents, ride.totalCents - feeCents);
    assert.equal(await balance(), before - feeCents);
    const fare = (await api('GET', `/passengers/rides/${rideId}`, { token: pToken })).body.ride.fare;
    assert.ok(fare.lines.some((line) => line.code === 'tolls'));
    assert.ok(!fare.lines.some((line) => line.code === 'wait'), 'espera não é cobrada');
  });

  await t.test('sem saldo para a taxa, o motorista não recebe a oferta', async () => {
    const current = await balance();
    const adjust = await api('POST', `/admin/drivers/${driver._id}/wallet/adjust`, { token: aToken, body: { amountCents: -current, note: 'Teste: zerar saldo' } });
    assert.equal(adjust.status, 200, JSON.stringify(adjust.body));
    assert.equal(adjust.body.balanceCents, 0);
    const negative = await api('POST', `/admin/drivers/${driver._id}/wallet/adjust`, { token: aToken, body: { amountCents: -1, note: 'Não pode' } });
    assert.equal(negative.status, 409);

    const rideId = await requestRide();
    await sleep(2500);
    const active = await api('GET', '/drivers/rides/active', { token: dToken });
    assert.equal(active.body.offer, null);
    assert.equal((await Ride.findById(rideId)).offers.length, 0);
    await api('POST', `/passengers/rides/${rideId}/cancel`, { token: pToken, body: {} });
  });

  await t.test('boas-vindas: uma vez por motorista', async () => {
    const first = await api('POST', '/admin/credits/welcome-existing', { token: aToken });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    assert.equal(first.body.granted, 1);
    assert.equal(await balance(), 1000);
    const second = await api('POST', '/admin/credits/welcome-existing', { token: aToken });
    assert.equal(second.body.granted, 0);
    assert.equal(await balance(), 1000);
  });

  await t.test('extrato explica o saldo (motorista e admin)', async () => {
    const mine = await api('GET', '/drivers/me/wallet/entries?limit=50', { token: dToken });
    assert.equal(mine.status, 200);
    assert.equal(mine.body.data[0].balanceAfterCents, 1000);
    const sum = mine.body.data.reduce((total, entry) => total + entry.amountCents, 0);
    assert.equal(sum, 1000);
    const fromAdmin = await api('GET', `/admin/drivers/${driver._id}/wallet`, { token: aToken });
    assert.equal(fromAdmin.body.balanceCents, 1000);
    assert.ok(fromAdmin.body.welcomeGrantedAt);

    const dashboard = await api('GET', '/admin/dashboard', { token: aToken });
    assert.equal(dashboard.body.billing.feesTodayCents, 2 * feeCents);
    assert.equal(dashboard.body.billing.creditsSoldTodayCents, 5000);
  });
});
