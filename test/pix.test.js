import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPixPayload, crc16, normalizePixKey, normalizeStoredPixKey, parsePixPayload, sanitizeText } from '../src/utils/pix.js';

// Mesmos casos do Delivroo v2 (tests/pix.test.js), adaptados para node:test.

test('pix: CRC16/CCITT-FALSE bate com o valor de referência', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('pix: normaliza cada tipo de chave', () => {
  const ok = (raw, key, type, hint) => assert.deepEqual(normalizePixKey(raw, hint), { ok: true, key, type });
  ok('529.982.247-25', '52998224725', 'CPF');
  ok('11.222.333/0001-81', '11222333000181', 'CNPJ');
  ok('12.abc.345/01de-35', '12ABC34501DE35', 'CNPJ'); // CNPJ alfanumérico (2026)
  ok('(35) 99999-1234', '+5535999991234', 'PHONE');
  ok('+55 35 99999-1234', '+5535999991234', 'PHONE');
  ok('  Operadora@Email.COM ', 'operadora@email.com', 'EMAIL');
  ok('3F2A9C1E8B7D4E6A9C1D2B3A4F5E6D7C', '3f2a9c1e-8b7d-4e6a-9c1d-2b3a4f5e6d7c', 'RANDOM');
  ok('35999991234', '+5535999991234', 'PHONE');
  ok('11144477735', '11144477735', 'CPF');
});

test('pix: CPF que também parece celular é ambíguo sem o tipo, e resolve com ele', () => {
  const both = '35999990076';
  const result = normalizePixKey(both);
  assert.equal(result.ok, false);
  assert.equal(result.code, 'PIX_KEY_AMBIGUOUS');
  assert.equal(normalizePixKey(both, 'CPF').type, 'CPF');
  assert.equal(normalizePixKey(both, 'PHONE').key, '+5535999990076');
  // depois de salva, 11 dígitos puros são CPF (telefone é sempre salvo com +55)
  assert.equal(normalizeStoredPixKey(both).type, 'CPF');
});

test('pix: chave inválida é recusada', () => {
  assert.equal(normalizePixKey('').code, 'PIX_KEY_EMPTY');
  assert.equal(normalizePixKey('123.456.789-00').ok, false);
  assert.equal(normalizePixKey('nao-e-uma-chave').ok, false);
});

test('pix: monta o copia e cola com valor, recebedor, cidade e identificador', () => {
  const payload = buildPixPayload({ key: '+5535999991234', name: 'Velo Mobilidade Ltda', city: 'Brazópolis', amountCents: 5000, txid: 'C7K3F9Q' });
  const fields = parsePixPayload(payload);
  assert.equal(fields['00'], '01');
  assert.equal(fields['01'], '11'); // QR estático
  assert.equal(fields['53'], '986'); // BRL
  assert.equal(fields['54'], '50.00');
  assert.equal(fields['59'], 'VELO MOBILIDADE LTDA');
  assert.equal(fields['60'], 'BRAZOPOLIS');
  assert.equal(parsePixPayload(fields['26'])['01'], '+5535999991234');
  assert.equal(parsePixPayload(fields['62'])['05'], 'C7K3F9Q');
  assert.equal(payload.slice(-4), crc16(payload.slice(0, -4)));
});

test('pix: valor inválido e texto do QR', () => {
  assert.throws(() => buildPixPayload({ key: 'a@b.com', name: 'X', city: 'Y', amountCents: 0, txid: 'A' }));
  assert.throws(() => buildPixPayload({ key: 'a@b.com', name: 'X', city: 'Y', amountCents: 10.5, txid: 'A' }));
  assert.equal(sanitizeText('São João del-Rei', 15), 'SAO JOAO DEL RE');
});
