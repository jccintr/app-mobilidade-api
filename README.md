# Mobilidade API

API multi-operadora (white label) para uma plataforma de mobilidade urbana. Esta primeira etapa traz:

- cadastro, login, verificação de e-mail e recuperação de senha de **passageiros** e **motoristas**;
- upload de **avatar** e de **documentos do motorista** (CNH, selfie, CRLV) com aprovação pelo painel;
- **motor de tarifa configurável** (horário, chuva, dia da semana, datas, zonas, adicionais), com simulador;
- gestão de operadoras (tenants) pelo dono da plataforma.

- **ciclo da corrida**: estimativa, pedido, despacho ao motorista mais próximo, aceite, chegada, início, fim, cancelamento e avaliação;
- **tempo real (Socket.IO)**: ofertas, mudanças de estado, posição ao vivo do motorista e **chat liberado somente depois que um motorista aceita**.

## Rodando

```bash
npm install
cp .env.example .env     # ajuste MONGODB_URI e JWT_SECRET (32+ caracteres)
SUPER_ADMIN_EMAIL=voce@exemplo.com SUPER_ADMIN_PASSWORD='senha-forte-12+' npm run seed -- --demo
npm run dev
npm test
```

Precisa de um MongoDB acessível (local ou Atlas/Railway). Sem SMTP configurado, os códigos de verificação aparecem no console. Com o SMTP no `.env`, o cadastro, o reenvio e a recuperação de senha enviam o código por e-mail (HTML na cor da operadora, com versão em texto). Teste com `npm run mail:test -- voce@exemplo.com`.
O seed com `--demo` cria a operadora `demo`, um admin dela (a senha é mostrada uma única vez) e uma regra de tarifa de exemplo.

## Conceitos

- **Operadora (tenant):** toda requisição de passageiro/motorista/admin envia `X-Tenant: <slug>`. Dados e tokens nunca cruzam operadoras.
- **Token:** `Authorization: Bearer <token>`. Trocar a senha ou bloquear invalida os tokens antigos.
- **Valores em reais** nas respostas; internamente o cálculo usa centavos inteiros.
- O nome da plataforma fica em `PLATFORM_NAME`.

## Endpoints

Passageiro (`/passengers`) e motorista (`/drivers`) compartilham:

| Método | Rota | Descrição |
|---|---|---|
| POST | `/register` | cadastro (`name,email,phone,password`) |
| POST | `/login` | `{token, user}` |
| POST | `/password/request` · `/password/verify-code` · `/password/reset` | recuperação por código |
| GET/PATCH | `/me` | perfil |
| PATCH | `/me/avatar` | multipart, campo `avatar` (jpeg/png/webp) |
| PATCH | `/me/push-token` | token de notificação |
| POST | `/verify-account` · `/verify-account/resend` | confirmação de e-mail |

Somente motorista: `PATCH /drivers/me/vehicle` e `PUT /drivers/me/documents/:type` (`cnh|selfie|crlv`, multipart, campo `file`, jpeg/png/webp/pdf).

Admin da operadora (`/admin`, `X-Tenant`): `POST /login`, `GET /me`, motoristas (`GET /drivers`, `GET /drivers/:id`, documento (`?link=1` devolve só o link temporário quando o armazenamento é Cloudinary), `approve`, `reject`, `block`, `unblock`), passageiros (`GET`, com contagem de corridas, `block`, `unblock`), tarifas (`GET /pricing-rules`, `/active`, `POST /pricing-rules`, `/:id/activate`, `/:id/deactivate`, `POST /pricing/simulate`).

Dono da plataforma (`/super`, sem `X-Tenant`): `POST /login`, `GET/POST /tenants`, `PATCH /tenants/:id`, `POST /tenants/:id/admins`.

### Exemplos

```bash
curl -X POST localhost:3333/passengers/register -H 'X-Tenant: demo' -H 'Content-Type: application/json' \
  -d '{"name":"Maria Silva","email":"maria@exemplo.com","phone":"35999990000","password":"minhasenha123"}'

curl -X PATCH localhost:3333/drivers/me/avatar -H 'X-Tenant: demo' -H "Authorization: Bearer $TOKEN" -F avatar=@foto.jpg

curl -X PUT localhost:3333/drivers/me/documents/cnh -H 'X-Tenant: demo' -H "Authorization: Bearer $TOKEN" -F file=@cnh.pdf
```

## Regra de tarifa

Cada regra é uma versão imutável (editar cria a versão seguinte); só uma fica ativa por operadora. Ordem do cálculo:

1. base + km × valor/km + minutos × valor/min;
2. tarifa mínima do veículo;
3. ajustes **percentuais** somados (limitados por `limits`), depois ajustes **fixos**;
4. adicionais (espera, paradas, pedágios);
5. arredondamento (`rounding.step`, `nearest|up`).

Condições de um ajuste (`when`): `timeRange` (pode atravessar a meia-noite), `weekdays` (0 = domingo), `dates`, `rain`, `zones`, `vehicleTypes`. Veja `src/pricing/exampleRule.js` e use `POST /admin/pricing/simulate` (aceita uma regra em rascunho) para testar antes de ativar.
A cobrança por tipo de terreno foi descartada (sem mapeamento confiável da superfície).

## Corridas

Passageiro (`/passengers`): `POST /rides/estimate`, `POST /rides`, `GET /rides/active`, `GET /rides`, `GET /rides/:id`, `POST /rides/:id/cancel`, `POST /rides/:id/rate`, `GET|POST /rides/:id/messages`.
Motorista (`/drivers`): `PATCH /me/online`, `POST /me/location`, `GET /rides/active` (corrida em curso e oferta pendente), `GET /rides`, `GET /rides/:id`, `POST /rides/:id/accept|decline|arrive|start|finish|cancel|rate`, `GET|POST /rides/:id/messages`.
Público: `GET /tenant/public` (nome, marca, cidades e onde o mapa abre, só com `X-Tenant`).
Configurações da operadora: `GET|PATCH /admin/settings` (nome exibido, cor, cidades, `map: {center:{lat,lng}, zoom}`), `PUT|DELETE /admin/settings/logo` (multipart, campo `logo`).
Admin: `GET /admin/dashboard` (números do início), `GET /admin/live` (motoristas online e corridas em aberto), `GET /admin/rides` (filtros `status`, `passengerId`, `driverId`), `GET /admin/rides/:id`, `GET|PUT /admin/conditions` (liga/desliga o modo chuva).

Estados: `requested → accepted → arrived → in_progress → completed`, com `cancelled` (passageiro até a chegada; motorista após aceitar; nunca em andamento) e `no_driver` (ninguém aceitou). A máquina de estados fica em `src/rides/stateMachine.js`.

- **Preço:** sempre calculado no servidor, pela regra ativa da operadora, e gravado na corrida junto com a versão da regra. Ao finalizar, espera (`waitMinutes`) e pedágio (`tolls`) informados pelo motorista recalculam o valor.
- **Despacho:** uma oferta por vez ao motorista aprovado, online, com posição recente e do tipo de veículo pedido, ordenado pela distância até a origem (índice geográfico do Mongo). Recusou ou deixou vencer: vai para o próximo, até `MAX_OFFERS` ou o fim da janela `DISPATCH_SEARCH_SECONDS` (então a corrida vira `no_driver`).
- **Concorrência:** aceitar, cancelar e as demais trocas de estado são atômicas no banco; dois aceites simultâneos não passam, e índices únicos impedem duas corridas vivas para o mesmo passageiro ou motorista.
- **Chat:** a regra é imposta no servidor (REST e socket): só com corrida `accepted`, `arrived` ou `in_progress`. Depois, o histórico segue legível.
- **Rotas/distância:** `ROUTING_PROVIDER=fake` (linha reta, só para desenvolver) ou `google` (Google Routes API, paga por requisição; ainda não testada com chave real). A troca é isolada em `src/services/routing`.
- **Chuva:** a operadora liga/desliga em `PUT /admin/conditions`; entra como `rain` no cálculo.

### Tempo real (Socket.IO)

Conectar em `PUBLIC_URL` com `auth: { token, tenant: "<slug>" }` (passageiro, motorista ou admin da operadora).
Servidor → app: `ride:offer` (motorista), `ride:update`, `ride:driver-location`, `chat:message`.
App → servidor: `driver:location` `{ lat, lng, heading }` e `chat:send` `{ rideId, text }`, ambos com callback `{ ok, ... }`.
Painel da operadora: conecte com o token do admin; recebe `live:ride` (toda mudança de corrida), `live:driver-location` e `live:driver-status`. Só escuta.
Posição: vai ao passageiro a cada ponto recebido e é gravada no banco no máximo a cada 10 s.

### Limites conhecidos desta etapa

- Timers de oferta em memória: serve para **uma instância** da API (um sweeper retoma o fluxo após reinício). Para várias instâncias, use uma fila (ex.: Redis).
- Se o motorista cancela após aceitar, a corrida termina (não é re-despachada ainda). Sem taxa de cancelamento.
- Pagamento só registra a forma (`cash` ou `pix_direct`); não há cobrança dentro do app.
- Zonas (ex.: rodoviária) ainda não são detectadas automaticamente: `zones` vai vazio no cálculo.
- Um socket já conectado só é revalidado na próxima conexão (bloqueio/troca de senha derruba na reconexão).

## Armazenamento

`STORAGE_DRIVER=local` grava em `UPLOAD_DIR` (avatares públicos em `/uploads/public`, documentos privados só via painel). Em hospedagens com disco efêmero (Railway sem volume) use `cloudinary`.

## Estado de verificação

- Motor de tarifa, códigos, detecção de arquivo, status do motorista e máquina de estados da corrida: **40 testes automatizados**.
- `test/integration.rides.test.js` percorre o ciclo inteiro (REST + Socket.IO) contra um MongoDB real, mas **só roda se `TEST_MONGODB_URI` estiver definido**; ele cria um banco temporário e o apaga no fim:
  `TEST_MONGODB_URI="mongodb://usuario:senha@host:porta/?authSource=admin" npm test` (sem nome de banco na URL).
- A aplicação sobe e responde `/health`, 404, validação de `X-Tenant` e 401.
- O ciclo da corrida e o teste de integração **não foram executados contra um MongoDB** por quem os escreveu (sem banco disponível no ambiente de desenvolvimento): rode o teste de integração antes de aprovar. O Cloudinary e o Google Routes também nunca rodaram com credenciais reais.
