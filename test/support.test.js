import test from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, newCodeRecord, checkCode, isTooSoon } from '../src/utils/codes.js';
import { sniffFileType } from '../src/utils/fileType.js';
import { nextDriverStatus, isProfileComplete } from '../src/modules/accounts/driverStatus.js';

const opts = { secret: 'x'.repeat(40) };

test('código: 6 dígitos', () => {
  for (let i = 0; i < 200; i++) assert.match(generateCode(), /^\d{6}$/);
});

test('código: ok, inválido, expirado, bloqueado, ausente', () => {
  const now = new Date('2026-01-01T10:00:00Z');
  const rec = newCodeRecord('123456', { now, ttlMinutes: 15 });
  assert.equal(checkCode(rec, '123456', { now }), 'ok');
  assert.equal(checkCode(rec, '000000', { now }), 'invalid');
  assert.equal(checkCode(rec, '123456', { now: new Date('2026-01-01T10:15:00Z') }), 'expired');
  assert.equal(checkCode({ ...rec, attempts: 5 }, '123456', { now }), 'locked');
  assert.equal(checkCode(undefined, '123456', { now }), 'missing');
});

test('código: reenvio muito rápido', () => {
  const now = new Date('2026-01-01T10:00:00Z');
  const rec = newCodeRecord('111111', { now });
  assert.equal(isTooSoon(rec, { now: new Date(now.getTime() + 30_000), resendSeconds: 60 }), true);
  assert.equal(isTooSoon(rec, { now: new Date(now.getTime() + 61_000), resendSeconds: 60 }), false);
  assert.equal(isTooSoon(undefined), false);
});

test('arquivo: detecta pelo conteúdo', () => {
  const pad = Buffer.alloc(16);
  assert.equal(sniffFileType(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), pad])), 'jpeg');
  assert.equal(sniffFileType(Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pad])), 'png');
  assert.equal(sniffFileType(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), pad])), 'webp');
  assert.equal(sniffFileType(Buffer.concat([Buffer.from('%PDF-1.7'), pad])), 'pdf');
  assert.equal(sniffFileType(Buffer.from('<script>alert(1)</script>')), null);
  assert.equal(sniffFileType(Buffer.alloc(3)), null);
});

test('status do motorista', () => {
  const base = { requireApproval: true, materialChange: false };
  assert.equal(nextDriverStatus({ ...base, current: 'incomplete', complete: false }), 'incomplete');
  assert.equal(nextDriverStatus({ ...base, current: 'incomplete', complete: true }), 'pending_approval');
  assert.equal(nextDriverStatus({ ...base, current: 'incomplete', complete: true, requireApproval: false }), 'approved');
  assert.equal(nextDriverStatus({ ...base, current: 'approved', complete: true }), 'approved');
  assert.equal(nextDriverStatus({ ...base, current: 'approved', complete: true, materialChange: true }), 'pending_approval');
  assert.equal(nextDriverStatus({ ...base, current: 'approved', complete: true, materialChange: true, requireApproval: false }), 'approved');
  assert.equal(nextDriverStatus({ ...base, current: 'rejected', complete: true }), 'pending_approval');
  assert.equal(nextDriverStatus({ ...base, current: 'blocked', complete: true }), 'blocked');
});

test('perfil completo exige veículo e 3 documentos', () => {
  const vehicle = { type: 'car', brand: 'Fiat', model: 'Uno', color: 'Branco', plate: 'ABC1D23', year: 2018 };
  const doc = { key: 'k' };
  assert.equal(isProfileComplete({ vehicle, documents: { cnh: doc, selfie: doc, crlv: doc } }), true);
  assert.equal(isProfileComplete({ vehicle, documents: { cnh: doc, selfie: doc } }), false);
  assert.equal(isProfileComplete({ vehicle: {}, documents: { cnh: doc, selfie: doc, crlv: doc } }), false);
});
