# Publicar a API no Render

## 1. Repositório (uma vez)
Na pasta `api`:
```
git init
git add .
git commit -m "API de mobilidade"
git branch -M main
git remote add origin https://github.com/SEU_USUARIO/mobilidade-api.git
git push -u origin main
```
(crie antes o repositório vazio, privado, no GitHub). O `.env` e a pasta `uploads/` não sobem: estão no `.gitignore`.

## 2. Render
1. render.com → New → **Blueprint** → escolha o repositório (ele lê o `render.yaml`).
2. Preencha as variáveis pedidas: `MONGODB_URI`, `CLOUDINARY_*`, `GOOGLE_MAPS_API_KEY`, SMTP, `CORS_ORIGINS`.
3. `PUBLIC_URL`: ainda não existe. Deixe qualquer valor, publique, copie o endereço que o Render deu
   (`https://....onrender.com`), coloque em `PUBLIC_URL` e salve (ele reinicia).
4. Teste: abra `https://SEU-SERVICO.onrender.com/health` → deve responder `ok`.

## 3. Banco
`MONGODB_URI` é o do MongoDB (hoje na Railway: use o endereço público/externo dela). Para operar de verdade,
use um banco separado do de desenvolvimento.
Criar a operadora no banco de produção (rodando no seu computador, com o `MONGODB_URI` de produção no `.env`):
`npm run seed` e depois `npm run tenant:create -- --slug velo ...`

## 4. Apps
Em cada app, `.env`: `EXPO_PUBLIC_API_URL=https://SEU-SERVICO.onrender.com`.
Para os builds do Expo: `apiUrl` em `tools/operators/<operadora>/operator.json`.

## Limites a conhecer
- Plano gratuito: o serviço dorme após minutos sem uso e demora ~1 min para acordar; o tempo real cai. Use plano pago.
- Rode **uma única instância**: o despacho de corridas e a posição dos motoristas ficam na memória do processo.
- Todo deploy reinicia o processo: corridas em busca de motorista naquele instante podem ser perdidas. Evite publicar em horário de pico.
