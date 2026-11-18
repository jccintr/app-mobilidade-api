/**
 * Recuperação de senha do administrador da operadora, contra um MongoDB REAL.
 * Só roda se TEST_MONGODB_URI estiver definido (cria um banco temporário e apaga no final).
 */
import 'dotenv/config';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import crypto from 'node:crypto';

const uri = process.env.TEST_MONGODB_URI;

test('recuperação de senha do operator_admin (banco real)', { skip: !uri && 'defina TEST_MONGODB_URI para rodar', timeout: 60_000 }, async (t) => {
  process.env.NODE_ENV = 'test';
  process.env.JWT_SECRET ||= 'x'.repeat(48);
  process.env.SMTP_HOST = ''; // sem SMTP: o e-mail sai no console

  const { default: mongoose } = await import('mongoose');
  const { default: bcrypt } = await import('bcryptjs');
  const { createApp } = await import('../src/app.js');
  const { Tenant } = await import('../src/models/Tenant.js');
  const { AdminUser } = await import('../src/models/AdminUser.js');

  const dbName = `mobilidade_test_${crypto.randomBytes(4).toString('hex')}`;
  await mongoose.connect(uri, { dbName, serverSelectionTimeoutMS: 10_000 });
  await Promise.all([Tenant, AdminUser].map((model) => model.init()));

  // Captura o código que "seria enviado" por e-mail.
  const originalLog = console.log;
  let lastMail = '';
  console.log = (...args) => {
    const text = args.join(' ');
    if (text.startsWith('[mailer:dev]')) lastMail = text;
    else originalLog(...args);
  };

  const server = createServer(createApp());
  await new Promise((resolve) => server.listen(0, resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  t.after(async () => {
    console.log = originalLog;
    server.close();
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  });

  const api = async (path, body, token) => {
    const response = await fetch(base + path, {
      method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Tenant': 'teste', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: response.status, data: await response.json().catch(() => ({})) };
  };

  const tenant = await Tenant.create({ name: 'Teste', slug: 'teste' });
  const email = 'admin@teste.com';
  await AdminUser.create({ tenantId: tenant._id, role: 'operator_admin', name: 'Admin', email, passwordHash: await bcrypt.hash('senha-antiga', 10) });

  const oldLogin = await api('/admin/login', { email, password: 'senha-antiga' });
  assert.equal(oldLogin.status, 200);

  // E-mail que não existe: mesma resposta, nenhum e-mail.
  const unknown = await api('/admin/password/request', { email: 'ninguem@teste.com' });
  assert.equal(unknown.status, 200);
  assert.equal(lastMail, '');

  const request = await api('/admin/password/request', { email });
  assert.equal(request.status, 200);
  await new Promise((resolve) => setTimeout(resolve, 50));
  const code = lastMail.match(/\b(\d{6})\b/)?.[1];
  assert.ok(code, 'o código deveria ter sido "enviado"');

  const wrong = await api('/admin/password/reset', { email, code: code === '000000' ? '111111' : '000000', password: 'senha-nova-123' });
  assert.equal(wrong.status, 400);
  assert.equal(wrong.data.error.code, 'INVALID_CODE');

  const reset = await api('/admin/password/reset', { email, code, password: 'senha-nova-123' });
  assert.equal(reset.status, 200);

  // O código não serve duas vezes; a sessão antiga cai; só a senha nova entra.
  assert.equal((await api('/admin/password/reset', { email, code, password: 'outra-senha-123' })).status, 400);
  assert.equal((await api('/admin/me', undefined, oldLogin.data.token)).status, 401);
  assert.equal((await api('/admin/login', { email, password: 'senha-antiga' })).status, 401);
  const newLogin = await api('/admin/login', { email, password: 'senha-nova-123' });
  assert.equal(newLogin.status, 200);
  assert.equal(newLogin.data.user.passwordReset, undefined);
});
