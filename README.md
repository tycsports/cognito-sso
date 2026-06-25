# cognito-sso

Mockup de SSO entre `www.tycsports.com` y `play.tycsports.com` usando Amazon Cognito Hosted UI.

Vanilla JS puro — sin Amplify, sin Google SDK, sin Facebook SDK. El login federado (Google, Facebook) lo maneja el Hosted UI de Cognito directamente.

## Estructura

```
cognito-sso/
├── config.js                  ← único archivo a tocar por entorno
├── js/
│   ├── pkce.js                ← PKCE (RFC 7636), sin dependencias
│   └── auth.js                ← flujo OAuth2/PKCE + token management
├── tycsports/
│   ├── index.html             ← simula www.tycsports.com
│   └── callback.html          ← recibe el code de Cognito
├── play/
│   ├── index.html             ← simula play.tycsports.com
│   └── callback.html
└── sso/
    └── index.html             ← dashboard: estado de ambas sesiones
```

