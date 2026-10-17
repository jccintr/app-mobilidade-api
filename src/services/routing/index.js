import { env } from '../../config/env.js';
import * as fake from './fake.js';
import * as google from './google.js';

/** Trocar de provedor de rotas = mexer só aqui (ou em ROUTING_PROVIDER). */
export function getRoute(origin, destination) {
  return (env.rides.routingProvider === 'google' ? google : fake).route(origin, destination);
}
