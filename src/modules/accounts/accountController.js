import bcrypt from 'bcryptjs';
import { env } from '../../config/env.js';
import { AppError, badRequest, forbidden, unauthorized } from '../../utils/errors.js';
import { signToken } from '../../utils/tokens.js';
import { checkCode, generateCode, isTooSoon, newCodeRecord } from '../../utils/codes.js';
import { EXT_BY_TYPE, MIME_BY_TYPE, sniffFileType } from '../../utils/fileType.js';
import { sendPasswordResetCode, sendVerificationCode } from '../../services/mailer.js';
import { storage } from '../../services/storage/index.js';

const BCRYPT_COST = 10;
// Comparação "de mentira" quando o e-mail não existe, para o tempo de resposta não revelar quem tem conta.
const DUMMY_HASH = bcrypt.hashSync('senha-falsa-para-igualar-o-tempo', BCRYPT_COST);

const codeError = (result) => {
  switch (result) {
    case 'locked':
      return new AppError(429, 'TOO_MANY_ATTEMPTS', 'Muitas tentativas. Solicite um novo código.');
    case 'missing':
    case 'expired':
      return new AppError(400, 'CODE_EXPIRED', 'Código expirado. Solicite um novo.');
    default:
      return new AppError(400, 'INVALID_CODE', 'Código incorreto.');
  }
};

const logMailError = (what) => (error) => console.error(`[mailer] falha ao enviar ${what}:`, error?.message ?? error);

/**
 * Cadastro, login, verificação de e-mail, recuperação de senha, perfil e avatar.
 * Serve para passageiro e motorista (a diferença fica no Model e no role).
 */
export function buildAccountController({ Model, role }) {
  const attempt = (path) => ({ $inc: { [`${path}.attempts`]: 1 } });

  return {
    async register(req, res) {
      const { name, email, phone, password } = req.valid;
      const tenantId = req.tenant._id;

      if (await Model.exists({ tenantId, email })) {
        throw new AppError(409, 'EMAIL_IN_USE', 'Este e-mail já está cadastrado.');
      }

      const code = generateCode();
      const account = await Model.create({
        tenantId,
        name,
        email,
        phone,
        passwordHash: await bcrypt.hash(password, BCRYPT_COST),
        verification: newCodeRecord(code),
      });

      sendVerificationCode({ to: email, name, code, tenant: req.tenant }).catch(logMailError('código de verificação'));

      res.status(201).json({ token: signToken(account, role), user: account });
    },

    async login(req, res) {
      const { email, password } = req.valid;
      const account = await Model.findOne({ tenantId: req.tenant._id, email }).select('+passwordHash');
      const passwordOk = await bcrypt.compare(password, account?.passwordHash ?? DUMMY_HASH);

      if (!account || !passwordOk) throw unauthorized('INVALID_CREDENTIALS', 'E-mail ou senha incorretos.');
      if (account.status === 'blocked') throw forbidden('ACCOUNT_BLOCKED', 'Conta bloqueada. Fale com a operadora.');

      await Model.updateOne({ _id: account._id }, { lastLoginAt: new Date() });
      res.json({ token: signToken(account, role), user: account });
    },

    me(req, res) {
      res.json({ user: req.user });
    },

    async updateMe(req, res) {
      const account = req.user;
      if (req.valid.name) account.name = req.valid.name;
      if (req.valid.phone) account.phone = req.valid.phone;
      await account.save();
      res.json({ user: account });
    },

    async updatePushToken(req, res) {
      await Model.updateOne({ _id: req.user._id }, { pushToken: req.valid.pushToken });
      res.json({ ok: true });
    },

    // ---- verificação de e-mail ----
    async verifyAccount(req, res) {
      const account = await Model.findById(req.user._id).select('+verification');
      if (account.emailVerified) return res.json({ user: account });

      const result = checkCode(account.verification, req.valid.code);
      if (result !== 'ok') {
        if (result === 'invalid') await Model.updateOne({ _id: account._id }, attempt('verification'));
        throw codeError(result);
      }

      account.emailVerified = true;
      account.verification = undefined;
      await account.save();
      res.json({ user: account });
    },

    async resendVerification(req, res) {
      const account = await Model.findById(req.user._id).select('+verification');
      if (account.emailVerified) return res.json({ sent: false, reason: 'ALREADY_VERIFIED' });
      if (isTooSoon(account.verification)) {
        throw new AppError(429, 'TOO_SOON', `Aguarde ${env.code.resendSeconds} segundos para pedir outro código.`);
      }

      const code = generateCode();
      account.verification = newCodeRecord(code);
      await account.save();
      sendVerificationCode({ to: account.email, name: account.name, code, tenant: req.tenant }).catch(
        logMailError('código de verificação'),
      );
      res.json({ sent: true });
    },

    // ---- recuperação de senha (resposta igual exista ou não a conta) ----
    async passwordRequest(req, res) {
      const account = await Model.findOne({ tenantId: req.tenant._id, email: req.valid.email }).select('+passwordReset');
      if (account && !isTooSoon(account.passwordReset)) {
        const code = generateCode();
        account.passwordReset = newCodeRecord(code);
        await account.save();
        sendPasswordResetCode({ to: account.email, name: account.name, code, tenant: req.tenant }).catch(
          logMailError('código de recuperação'),
        );
      }
      res.json({ sent: true });
    },

    async passwordVerifyCode(req, res) {
      const account = await Model.findOne({ tenantId: req.tenant._id, email: req.valid.email }).select('+passwordReset');
      const result = account ? checkCode(account.passwordReset, req.valid.code) : 'invalid';
      if (result !== 'ok') {
        if (account && result === 'invalid') await Model.updateOne({ _id: account._id }, attempt('passwordReset'));
        throw codeError(result);
      }
      res.json({ valid: true });
    },

    async passwordReset(req, res) {
      const { email, code, password } = req.valid;
      const account = await Model.findOne({ tenantId: req.tenant._id, email }).select('+passwordReset +passwordHash');
      const result = account ? checkCode(account.passwordReset, code) : 'invalid';
      if (result !== 'ok') {
        if (account && result === 'invalid') await Model.updateOne({ _id: account._id }, attempt('passwordReset'));
        throw codeError(result);
      }

      account.passwordHash = await bcrypt.hash(password, BCRYPT_COST);
      account.passwordReset = undefined;
      account.tokenVersion = (account.tokenVersion ?? 0) + 1; // encerra as sessões antigas
      await account.save();
      res.json({ ok: true });
    },

    // ---- avatar ----
    async uploadAvatar(req, res) {
      if (!req.file) throw badRequest('FILE_REQUIRED', 'Envie a imagem no campo "avatar".');
      const kind = sniffFileType(req.file.buffer);
      if (!['jpeg', 'png', 'webp'].includes(kind)) {
        throw new AppError(415, 'INVALID_FILE_TYPE', 'Envie uma imagem JPG, PNG ou WEBP.');
      }

      const asset = await storage.save(req.file.buffer, {
        folder: `${req.tenant.slug}/${role}s/avatars`,
        ext: EXT_BY_TYPE[kind],
        mimetype: MIME_BY_TYPE[kind],
        privacy: 'public',
      });

      const account = req.user;
      const previous = account.avatar?.key ? { ...account.avatar.toObject() } : null;
      account.avatar = asset;
      await account.save();
      if (previous) storage.remove(previous).catch(() => {});

      res.json({ user: account });
    },
  };
}
