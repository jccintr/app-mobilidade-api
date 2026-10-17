/**
 * Valida req[source] com um schema do zod e guarda o resultado limpo em req.valid.
 * (Não sobrescreve req.query/req.body: no Express 5 req.query é somente leitura.)
 */
export function validate(schema, source = 'body') {
  return (req, _res, next) => {
    const result = schema.safeParse(req[source] ?? {});
    if (!result.success) return next(result.error);
    req.valid = { ...(req.valid ?? {}), ...result.data };
    next();
  };
}
