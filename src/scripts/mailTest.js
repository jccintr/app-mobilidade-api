import 'dotenv/config';
import { env } from '../config/env.js';
import { sendVerificationCode, verifyMailer } from '../services/mailer.js';

/**
 * Testa o envio de e-mail:  npm run mail:test -- voce@exemplo.com
 * 1) confere a conexão/credenciais do SMTP;  2) envia um código de verificação de exemplo.
 */
const to = process.argv[2];
if (!to) {
  console.error('Uso: npm run mail:test -- voce@exemplo.com');
  process.exit(1);
}

try {
  const status = await verifyMailer();
  if (!status.configured) {
    console.log('SMTP_HOST está vazio: o e-mail só foi impresso acima, nada foi enviado. Preencha o SMTP no .env.');
    process.exit(0);
  } else {
    console.log(`SMTP ok (${env.smtp.host}:${env.smtp.port}, secure=${env.smtp.secure}).`);
  }
  await sendVerificationCode({ to, name: 'Teste', code: '123456', tenant: { name: env.platformName, brand: { primaryColor: '#1f3a5f' } } });
  console.log(`Mensagem de teste enviada para ${to}. Confira a caixa de entrada e o spam.`);
} catch (error) {
  console.error('Falha no envio:', error.code ? `${error.code} - ` : '', error.message);
  console.error('Dicas: porta 465 exige SMTP_SECURE=true; porta 587 exige SMTP_SECURE=false; Gmail pede "senha de app".');
  process.exit(1);
}
