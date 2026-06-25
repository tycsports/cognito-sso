# cognito-sso

Mockup de SSO entre `www.tycsports.com` y `play.tycsports.com` usando Amazon Cognito Hosted UI.

Vanilla JS puro — sin Amplify, sin Google SDK, sin Facebook SDK. El login federado (Google, Facebook) lo maneja el Hosted UI de Cognito directamente. Diseñado para escalar a sitios adicionales (El Gráfico, Carburando, etc.) sin tocar el código de autenticación.

---

## Cómo funciona el SSO

```
  /tycsports/          Cognito Hosted UI          /play/
      │                  (auth.tycsports.com)          │
      │  1. login()              │                     │
      │ ─────────────────────►   │                     │
      │                          │ session cookie       │
      │  2. redirect + code      │ (dominio Cognito)   │
      │ ◄─────────────────────   │                     │
      │  3. /oauth2/token        │                     │
      │ ─────────────────────►   │                     │
      │  4. access/id/refresh    │                     │
      │ ◄─────────────────────   │                     │
      │  5. guarda en            │                     │
      │     localStorage         │                     │
      │     tycsports__*         │                     │
                                 │                     │
                                 │   6. login()        │
                                 │ ◄───────────────── │
                                 │   detecta cookie    │
                                 │   → sin login       │
                                 │   7. redirect + code│
                                 │ ──────────────────► │
                                 │   8. /oauth2/token  │
                                 │ ◄───────────────── │
                                 │   9. guarda         │
                                 │      play__*        │
```

**Clave del SSO**: Cognito mantiene su propia sesión (cookie en el dominio del Hosted UI). Cuando el segundo sitio inicia el flujo OAuth, Cognito detecta la cookie y completa el redirect sin pedir credenciales.

### Flujo detallado

1. Usuario hace click en "Iniciar sesión" en `/tycsports/`
2. `Auth.login('tycsports')` genera un PKCE (`code_verifier`, `code_challenge`, `state`) y redirige al Hosted UI
3. El Hosted UI muestra opciones: email/contraseña, Google, Facebook (configurados en Cognito — sin SDK de terceros en el cliente)
4. Cognito autentica y redirige a `/tycsports/callback.html?code=xxx&state=yyy`
5. `Auth.handleCallback('tycsports')` verifica el `state`, intercambia el `code` por tokens vía POST a `/oauth2/token`
6. Tokens guardados en `localStorage` con prefijo `tycsports__`
7. Usuario va a `/play/` y hace click en "Iniciar sesión"
8. `Auth.login('play')` redirige al Hosted UI — **Cognito detecta su cookie de sesión**
9. Cognito redirige inmediatamente a `/play/callback.html?code=yyy` **sin pedir credenciales**
10. Tokens guardados con prefijo `play__`

### Logout

`Auth.logout(site)` limpia el `localStorage` local y redirige al endpoint `/logout` de Cognito, que **invalida la sesión del Hosted UI**. Si el usuario intenta entrar a cualquier otro sitio después, Cognito pedirá credenciales de nuevo.

> Si solo se limpia `localStorage` sin redirigir a `/logout`, el otro sitio seguiría pudiendo hacer SSO silencioso. El logout tiene que ser federado.

### Por qué los prefijos en localStorage

En este mockup los tres "sitios" corren en el mismo dominio (`localhost:8080` o `auth.tycsports.com`), por eso cada sitio usa un prefijo (`tycsports__`, `play__`) para evitar que se pisen las keys. En producción, `www.tycsports.com` y `play.tycsports.com` tienen dominios separados → `localStorage` aislado → se usan las keys sin prefijo, idénticas a las de `cognito-new` (`_tyc_utslg`, `tycuid`, `ipu`).

---

## Estructura del proyecto

```
cognito-sso/
├── .env.example               ← template de variables (commitear)
├── .env                       ← valores reales (NO commitear)
├── config.js                  ← AUTO-GENERADO desde .env (NO commitear)
├── package.json
├── scripts/
│   └── generate-config.js     ← genera config.js a partir del .env
├── js/
│   ├── pkce.js                ← PKCE (RFC 7636) — vanilla JS, sin deps
│   └── auth.js                ← login, callback, sesión, logout
├── tycsports/
│   ├── index.html             ← simula www.tycsports.com
│   └── callback.html          ← recibe el code de Cognito
├── play/
│   ├── index.html             ← simula play.tycsports.com
│   └── callback.html
└── sso/
    └── index.html             ← dashboard: estado de ambas sesiones
```

---

## Setup

### 1. Requisitos en AWS Cognito

Antes de correr el proyecto necesitás configurar en Cognito:

**Hosted UI domain** (App integration → Domain):
- Podés usar el subdominio generado: `tycsports.auth.us-east-1.amazoncognito.com`
- O un custom domain via Route 53: `auth.tycsports.com` (requiere cert ACM en `us-east-1`)

**Dos App Clients** (App integration → App clients), uno por sitio:

| Setting | Valor |
|---|---|
| Allowed OAuth flows | `Authorization code grant` |
| Allowed OAuth scopes | `openid`, `email`, `profile` |
| Callback URLs | `http://localhost:8080/tycsports/callback.html` y `https://auth.tycsports.com/tycsports/callback.html` |
| Logout URLs | `http://localhost:8080/tycsports/` y `https://auth.tycsports.com/tycsports/` |
| Identity providers | Cognito User Pool, Google, Facebook |

Repetir para el App Client de `play` con sus URLs correspondientes.

**Identity providers** (Sign-in experience → Federated identity provider sign-in):
- Configurar Google con el Client ID y Secret de Google Cloud Console
- Configurar Facebook con el App ID y Secret de Meta Developers
- El Hosted UI muestra los botones automáticamente — no hay SDK de terceros en el cliente

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar variables de entorno

```bash
cp .env.example .env
```

Completar `.env`:

```env
AWS_COGNITO_REGION=us-east-1
AWS_USER_POOLS_ID=us-east-1_XXXXXXXXX
AWS_COGNITO_HOSTED_UI_DOMAIN=tycsports.auth.us-east-1.amazoncognito.com
AWS_CLIENT_ID_TYCSPORTS=xxxxxxxxxxxxxxxxxxxxxxxxxx
AWS_CLIENT_ID_PLAY=xxxxxxxxxxxxxxxxxxxxxxxxxx
REDIRECT_BASE_LOCAL=http://localhost:8080
REDIRECT_BASE_PROD=https://auth.tycsports.com
```

---

## Comandos

```bash
# Genera config.js desde .env (se ejecuta automáticamente antes de dev)
npm run generate:config

# Levanta el servidor local en http://localhost:8080
# (genera config.js automáticamente vía predev)
npm run dev
```

Abrir: [http://localhost:8080/tycsports/](http://localhost:8080/tycsports/)

> Cognito permite callbacks a `http://localhost` sin HTTPS. No se necesita certificado para desarrollo.

---

## Deploy a S3

```bash
# 1. Generar config.js con las variables de prod
REDIRECT_BASE_LOCAL=http://localhost:8080 \
REDIRECT_BASE_PROD=https://auth.tycsports.com \
npm run generate:config

# 2. Subir al bucket
aws s3 sync . s3://NOMBRE-DEL-BUCKET \
  --exclude ".git/*" \
  --exclude "node_modules/*" \
  --exclude ".env*" \
  --exclude "scripts/*" \
  --delete
```

Configurar el bucket S3 con:
- Static website hosting habilitado
- Index document: `index.html`
- CORS habilitado si es necesario

En Route 53: crear un registro `A` o `CNAME` para `auth.tycsports.com` apuntando al bucket o a un CloudFront distribution.

---

## Agregar un sitio nuevo

Ejemplo: agregar El Gráfico.

**1. `.env`** — agregar el Client ID del nuevo App Client:
```env
AWS_CLIENT_ID_ELGRAFICO=xxxxxxxxxxxxxxxxxxxxxxxxxx
```

**2. `scripts/generate-config.js`** — descomentar o agregar la entrada en `sites`:
```js
sites: {
    tycsports:  { client_id: required('AWS_CLIENT_ID_TYCSPORTS') },
    play:       { client_id: required('AWS_CLIENT_ID_PLAY') },
    elgrafico:  { client_id: required('AWS_CLIENT_ID_ELGRAFICO') },  // ← agregar
},
```

**3. Crear las páginas HTML** — copiar `tycsports/` como base, cambiar `const SITE = 'elgrafico'` y ajustar el estilo.

**4. En Cognito** — crear el App Client con las callback URLs del nuevo sitio.

`auth.js` no necesita ningún cambio. La función `clientId(site)` resuelve cualquier site desde el mapa de configuración.
