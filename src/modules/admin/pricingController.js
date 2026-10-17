import { PricingRule } from '../../models/PricingRule.js';
import { calculateFare, PricingError } from '../../pricing/engine.js';
import { AppError, conflict, notFound } from '../../utils/errors.js';

async function nextVersion(tenantId) {
  const last = await PricingRule.findOne({ tenantId }).sort({ version: -1 }).select('version').lean();
  return (last?.version ?? 0) + 1;
}

async function activate(rule) {
  await PricingRule.updateMany({ tenantId: rule.tenantId, _id: { $ne: rule._id }, active: true }, { active: false });
  rule.active = true;
  await rule.save();
}

export const pricingController = {
  async list(req, res) {
    const rules = await PricingRule.find({ tenantId: req.tenant._id }).sort({ version: -1 }).limit(100);
    res.json({ data: rules });
  },

  async active(req, res) {
    const rule = await PricingRule.findOne({ tenantId: req.tenant._id, active: true });
    if (!rule) throw notFound('NO_ACTIVE_RULE', 'Nenhuma regra de tarifa ativa. Crie e ative uma regra.');
    res.json({ rule });
  },

  /** Cria uma nova versão (nunca altera uma antiga: corridas passadas continuam explicáveis). */
  async create(req, res) {
    const { name, notes, activate: shouldActivate, config } = req.valid;
    let rule;
    // A versão é sequencial por operadora; se duas criações colidirem, tenta de novo uma vez.
    for (let attempt = 0; attempt < 2 && !rule; attempt++) {
      try {
        rule = await PricingRule.create({
          tenantId: req.tenant._id,
          name,
          notes,
          config,
          version: await nextVersion(req.tenant._id),
          createdBy: req.user._id,
        });
      } catch (error) {
        if (error?.code !== 11000 || attempt === 1) throw error;
      }
    }
    if (shouldActivate) await activate(rule);
    res.status(201).json({ rule });
  },

  async activateRule(req, res) {
    const rule = await PricingRule.findOne({ _id: req.valid.id, tenantId: req.tenant._id });
    if (!rule) throw notFound('RULE_NOT_FOUND', 'Regra não encontrada.');
    await activate(rule);
    res.json({ rule });
  },

  async deactivateRule(req, res) {
    const rule = await PricingRule.findOne({ _id: req.valid.id, tenantId: req.tenant._id });
    if (!rule) throw notFound('RULE_NOT_FOUND', 'Regra não encontrada.');
    if (!rule.active) throw conflict('INVALID_STATE', 'Esta regra já está inativa.');
    rule.active = false;
    await rule.save();
    res.json({ rule });
  },

  /** Simulador do painel: mostra a conta completa antes de publicar uma regra. */
  async simulate(req, res) {
    const { ruleId, config, input } = req.valid;
    let used = config;
    let source = 'draft';

    if (!used) {
      const rule = ruleId
        ? await PricingRule.findOne({ _id: ruleId, tenantId: req.tenant._id })
        : await PricingRule.findOne({ tenantId: req.tenant._id, active: true });
      if (!rule) throw notFound('RULE_NOT_FOUND', 'Regra de tarifa não encontrada.');
      used = rule.config;
      source = `rule:v${rule.version}`;
    }

    try {
      res.json({ source, fare: calculateFare(used, input) });
    } catch (error) {
      if (error instanceof PricingError) throw new AppError(422, error.code, error.message);
      throw error;
    }
  },
};
