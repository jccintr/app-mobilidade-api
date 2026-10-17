import nodemailer from 'nodemailer';
import { env } from '../config/env.js';

let transporter;

function getTransporter() {
  if (transporter !== undefined) return transporter;
  if (!env.smtp.host) {
    transporter = null; // sem SMTP: em desenvolvimento, os códigos aparecem no console
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

export async function sendMail({ to, subject, text, html }) {
  const mailer = getTransporter();
  if (!mailer) {
    console.log(`[mailer:dev] Para: ${to}\nAssunto: ${subject}\n${text}\n`);
    return { dev: true };
  }
  return mailer.sendMail({ from: env.smtp.from || env.smtp.user, to, subject, text, html });
}

const brandName = (tenant) => tenant?.brand?.displayName || tenant?.name || env.platformName;

const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

/** E-mail com o código em destaque, na cor da operadora (a versão em texto continua junto, para leitores simples). */
export function codeEmailHtml({ brand, color, title, name, intro, code, minutes, footer }) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color : '#1f3a5f';
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1d2433">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="background:${accent};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold">${escapeHtml(brand)}</td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>
        <p style="margin:0 0 20px;line-height:1.5">Olá, ${escapeHtml(name)}! ${escapeHtml(intro)}</p>
        <p style="margin:0 0 20px;text-align:center;font-size:34px;letter-spacing:8px;font-weight:bold;font-family:'Courier New',monospace">${escapeHtml(code)}</p>
        <p style="margin:0 0 20px;line-height:1.5;color:#5b6475">O código vale por ${minutes} minutos. Não compartilhe com ninguém.</p>
        <p style="margin:0;font-size:13px;color:#8a93a3">${escapeHtml(footer)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

export function sendVerificationCode({ to, name, code, tenant }) {
  const brand = brandName(tenant);
  const minutes = env.code.ttlMinutes;
  return sendMail({
    to,
    subject: `${brand}: seu código de verificação`,
    text: `Olá, ${name}!\n\nSeu código de verificação é: ${code}\nEle vale por ${minutes} minutos.\n\nSe você não criou uma conta, ignore este e-mail.`,
    html: codeEmailHtml({
      brand,
      color: tenant?.brand?.primaryColor,
      title: 'Confirme seu e-mail',
      name,
      intro: 'Use o código abaixo para confirmar seu e-mail.',
      code,
      minutes,
      footer: 'Se você não criou uma conta, ignore este e-mail.',
    }),
  });
}

export function sendPasswordResetCode({ to, name, code, tenant }) {
  const brand = brandName(tenant);
  const minutes = env.code.ttlMinutes;
  return sendMail({
    to,
    subject: `${brand}: recuperação de senha`,
    text: `Olá, ${name}!\n\nSeu código para redefinir a senha é: ${code}\nEle vale por ${minutes} minutos.\n\nSe você não pediu a recuperação, ignore este e-mail.`,
    html: codeEmailHtml({
      brand,
      color: tenant?.brand?.primaryColor,
      title: 'Redefinir senha',
      name,
      intro: 'Use o código abaixo para criar uma nova senha.',
      code,
      minutes,
      footer: 'Se você não pediu a recuperação, ignore este e-mail: sua senha continua a mesma.',
    }),
  });
}

/** E-mail de aviso simples (sem código), na cor da operadora. */
export function noticeEmailHtml({ brand, color, title, name, paragraphs, footer }) {
  const accent = /^#[0-9a-fA-F]{6}$/.test(color ?? '') ? color : '#1f3a5f';
  const body = paragraphs.map((p) => `<p style="margin:0 0 16px;line-height:1.5">${escapeHtml(p)}</p>`).join('\n        ');
  return `<!doctype html>
<html lang="pt-BR"><body style="margin:0;padding:24px;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1d2433">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center">
    <table role="presentation" width="480" cellspacing="0" cellpadding="0" style="max-width:480px;background:#ffffff;border-radius:12px;overflow:hidden">
      <tr><td style="background:${accent};padding:20px 28px;color:#ffffff;font-size:18px;font-weight:bold">${escapeHtml(brand)}</td></tr>
      <tr><td style="padding:28px">
        <h1 style="margin:0 0 12px;font-size:20px">${escapeHtml(title)}</h1>
        <p style="margin:0 0 16px;line-height:1.5">Olá, ${escapeHtml(name)}!</p>
        ${body}
        <p style="margin:8px 0 0;font-size:13px;color:#8a93a3">${escapeHtml(footer)}</p>
      </td></tr>
    </table>
  </td></tr></table>
</body></html>`;
}

/** Avisa o motorista por e-mail que o cadastro foi aprovado ou reprovado (reason = motivo, no caso de reprovação). */
export function sendDriverReviewEmail({ to, name, tenant, approved, reason }) {
  const brand = brandName(tenant);
  const title = approved ? 'Cadastro aprovado!' : 'Seu cadastro precisa de ajustes';
  const paragraphs = approved
    ? [`Seu cadastro como motorista da ${brand} foi aprovado.`, 'Abra o app, toque em ficar online e comece a receber corridas.']
    : [`A análise do seu cadastro na ${brand} encontrou um ponto a corrigir:`, reason, 'Abra o app, ajuste o que for preciso e reenvie para uma nova análise.'];
  return sendMail({
    to,
    subject: `${brand}: ${title.toLowerCase().replace(/^./, (c) => c.toUpperCase())}`,
    text: `Olá, ${name}!\n\n${paragraphs.join('\n\n')}`,
    html: noticeEmailHtml({ brand, color: tenant?.brand?.primaryColor, title, name, paragraphs, footer: `Mensagem automática da ${brand}.` }),
  });
}

/** Confere host, porta, usuário e senha do SMTP sem enviar nada. */
export async function verifyMailer() {
  const mailer = getTransporter();
  if (!mailer) return { configured: false };
  await mailer.verify();
  return { configured: true };
}
