import { Router } from 'express';

/** Dados públicos da operadora (tela de login e apps mostram nome, logo e cor). */
export const publicTenantRouter = Router();

publicTenantRouter.get('/', (req, res) => {
  const { name, slug, brand = {}, cities = [], map } = req.tenant;
  res.json({
    tenant: {
      name,
      slug,
      brand: {
        displayName: brand.displayName || name,
        primaryColor: brand.primaryColor || '#111827',
        logoUrl: brand.logoUrl || null,
      },
      cities,
      map: map?.center?.lat !== undefined ? { center: map.center, zoom: map.zoom ?? 13 } : null,
    },
  });
});
