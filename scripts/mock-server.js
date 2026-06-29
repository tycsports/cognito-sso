/**
 * Mock server — simula Cognito Hosted UI para desarrollo local sin AWS.
 * Sirve los archivos estáticos Y mockea los endpoints OAuth2 de Cognito.
 *
 * Uso: npm run dev:mock
 * Abre: http://localhost:8080/tycsports/
 */

const http = require('http');
const fs   = require('fs');
const path = require('path');
const url  = require('url');

const PORT = 8080;
const ROOT = path.resolve(__dirname, '..');

// Codes temporales: code → datos del usuario (se borran al canjear)
const pendingCodes = new Map();

// ─── JWT helpers ────────────────────────────────────────────────────────────

function b64url(obj) {
    return Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))
        .toString('base64')
        .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function makeFakeJWT(payload) {
    const header = b64url({ alg: 'RS256', typ: 'JWT' });
    const body   = b64url(payload);
    return `${header}.${body}.mock-sig`;
}

// ─── Body parser ─────────────────────────────────────────────────────────────

function parseBody(req) {
    return new Promise(resolve => {
        let raw = '';
        req.on('data', chunk => raw += chunk);
        req.on('end', () => resolve(Object.fromEntries(new URLSearchParams(raw))));
    });
}

// ─── Static file server ──────────────────────────────────────────────────────

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js':   'application/javascript; charset=utf-8',
    '.css':  'text/css',
    '.json': 'application/json',
    '.png':  'image/png',
    '.ico':  'image/x-icon',
};

function serveStatic(res, filePath) {
    // Si es directorio, busca index.html
    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
        filePath = path.join(filePath, 'index.html');
    }
    if (!fs.existsSync(filePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
    }
    const mime = MIME[path.extname(filePath)] || 'text/plain';
    res.writeHead(200, { 'Content-Type': mime });
    res.end(fs.readFileSync(filePath));
}

// ─── Login form HTML ─────────────────────────────────────────────────────────

function loginForm(redirectUri, state) {
    return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>TyC Sports — Iniciar sesión</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    background: rgba(0,0,0,0.55);
    min-height: 100vh;
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .modal {
    background: #fff;
    border-radius: 10px;
    width: 100%; max-width: 340px;
    padding: 28px 28px 24px;
    position: relative;
    box-shadow: 0 8px 40px rgba(0,0,0,0.35);
  }
  .mock-badge {
    position: absolute; top: 12px; right: 12px;
    background: #f59e0b; color: #fff;
    font-size: 9px; font-weight: 700; letter-spacing: 0.06em;
    padding: 2px 7px; border-radius: 4px; text-transform: uppercase;
  }
  .logo-wrap { text-align: center; margin-bottom: 18px; }
  .logo-wrap img { height: 32px; }
  .subtitle { font-size: 13px; color: #444; text-align: center; margin-bottom: 16px; }

  /* Social buttons */
  .btn-fb {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; padding: 11px 16px; border-radius: 6px; border: none;
    background: #1877f2; color: #fff;
    font-size: 14px; font-weight: 600; cursor: pointer; margin-bottom: 10px;
  }
  .btn-fb:hover { background: #1464d8; }

  .btn-google {
    display: flex; align-items: center; justify-content: center; gap: 10px;
    width: 100%; padding: 10px 16px; border-radius: 6px;
    background: #fff; color: #3c4043;
    border: 1px solid #dadce0;
    font-size: 14px; font-weight: 500; cursor: pointer; margin-bottom: 16px;
  }
  .btn-google:hover { background: #f8f9fa; border-color: #c6c9cc; }

  .divider {
    display: flex; align-items: center; gap: 10px;
    color: #999; font-size: 12px; margin-bottom: 14px;
  }
  .divider::before, .divider::after {
    content: ''; flex: 1; height: 1px; background: #e5e5e5;
  }

  label { display: block; font-size: 12px; color: #555; margin-bottom: 4px; }
  input[type=email], input[type=password] {
    width: 100%; padding: 9px 11px; border-radius: 5px;
    border: 1px solid #ccc; font-size: 14px; color: #222;
    margin-bottom: 12px; outline: none;
  }
  input[type=email]:focus, input[type=password]:focus {
    border-color: #1c66d9; box-shadow: 0 0 0 2px rgba(28,102,217,0.12);
  }

  .btn-submit {
    width: 100%; padding: 12px; border-radius: 6px; border: none;
    background: #e3001b; color: #fff;
    font-size: 15px; font-weight: 700; letter-spacing: 0.04em;
    cursor: pointer; margin-bottom: 14px;
    text-transform: uppercase;
  }
  .btn-submit:hover { background: #c4001a; }

  .footer-links { display: flex; justify-content: space-between; }
  .footer-links a { font-size: 12px; color: #1c66d9; text-decoration: none; }
  .footer-links a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div class="modal">
  <span class="mock-badge">MOCK</span>

  <div class="logo-wrap">
    <img src="https://statics-files.tycsports.com/frontend/tycsports/img/logos_2026/logo-azul.svg" alt="TyC Sports">
  </div>
  <p class="subtitle">Podés ingresar con tu cuenta de:</p>

  <!-- Facebook -->
  <form method="POST" style="margin:0">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="state"        value="${state}">
    <input type="hidden" name="email"        value="fb.user@facebook.com">
    <input type="hidden" name="name"         value="Usuario Facebook">
    <input type="hidden" name="provider"     value="Facebook">
    <button class="btn-fb" type="submit">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="#fff"><path d="M24 12.073C24 5.405 18.627 0 12 0S0 5.405 0 12.073C0 18.1 4.388 23.094 10.125 24v-8.437H7.078v-3.49h3.047V9.413c0-3.018 1.79-4.686 4.533-4.686 1.313 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.93-1.956 1.886v2.252h3.328l-.532 3.49h-2.796V24C19.612 23.094 24 18.1 24 12.073z"/></svg>
      Facebook
    </button>
  </form>

  <!-- Google -->
  <form method="POST" style="margin:0">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="state"        value="${state}">
    <input type="hidden" name="email"        value="google.user@gmail.com">
    <input type="hidden" name="name"         value="Usuario Google">
    <input type="hidden" name="provider"     value="Google">
    <button class="btn-google" type="submit">
      <svg width="18" height="18" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
      Acceder con Google
    </button>
  </form>

  <div class="divider">o con tu cuenta de Email</div>

  <form method="POST">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="state"        value="${state}">
    <input type="hidden" name="provider"     value="Cognito">
    <label>Email:</label>
    <input type="email" name="email" value="test@tycsports.com" placeholder="email@ejemplo.com" required>
    <label>Contraseña:</label>
    <input type="password" name="password" placeholder="Contraseña" required>
    <button class="btn-submit" type="submit">Ingresar</button>
    <div class="footer-links">
      <a href="#">¿Olvidaste tu contraseña?</a>
      <a href="#">Registrarse</a>
    </div>
  </form>
</div>
</body>
</html>`;
}

// ─── Request handler ──────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
    const parsed   = url.parse(req.url, true);
    const pathname = parsed.pathname;
    const query    = parsed.query;

    // GET /mock-cognito/oauth2/authorize → muestra el formulario de login
    if (pathname === '/mock-cognito/oauth2/authorize' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(loginForm(query.redirect_uri || '', query.state || ''));
        return;
    }

    // POST /mock-cognito/oauth2/authorize → genera un fake code y redirige
    if (pathname === '/mock-cognito/oauth2/authorize' && req.method === 'POST') {
        const body = await parseBody(req);
        const code = Math.random().toString(36).slice(2) + Date.now().toString(36);

        pendingCodes.set(code, {
            email:    body.email    || 'test@tycsports.com',
            name:     body.name     || (body.email || 'test').split('@')[0],
            provider: body.provider || 'Cognito',
            sub:      'mock-' + Buffer.from(body.email || 'test').toString('hex').slice(0, 8),
        });

        const redirectTo = `${body.redirect_uri}?code=${code}&state=${encodeURIComponent(body.state || '')}`;
        res.writeHead(302, { Location: redirectTo });
        res.end();
        return;
    }

    // POST /mock-cognito/oauth2/token → intercambia code por tokens falsos
    if (pathname === '/mock-cognito/oauth2/token' && req.method === 'POST') {
        const body = await parseBody(req);
        let user;

        if (body.grant_type === 'authorization_code') {
            user = pendingCodes.get(body.code);
            if (user) pendingCodes.delete(body.code);
        } else if (body.grant_type === 'refresh_token') {
            // Simula refresh exitoso con usuario genérico
            const sub = body.refresh_token?.replace('mock-refresh-', '') || 'mock-refreshed';
            user = { email: 'test@tycsports.com', name: 'Test User', provider: 'Cognito', sub };
        }

        if (!user) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid_grant', error_description: 'Código inválido o expirado.' }));
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const idToken = makeFakeJWT({
            sub:                user.sub,
            email:              user.email,
            name:               user.name,
            'cognito:username': user.email,
            iat: now, exp: now + 3600,
            iss: 'http://localhost:8080/mock-cognito',
            ...(user.provider !== 'Cognito' ? {
                identities: [{ providerName: user.provider, userId: user.sub }],
            } : {}),
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            access_token:  makeFakeJWT({ sub: user.sub, scope: 'openid email profile', iat: now, exp: now + 3600 }),
            id_token:      idToken,
            refresh_token: `mock-refresh-${user.sub}`,
            expires_in:    3600,
            token_type:    'Bearer',
        }));
        return;
    }

    // GET /mock-cognito/logout → redirige a logout_uri (invalida sesión mock)
    if (pathname === '/mock-cognito/logout') {
        const logoutUri = query.logout_uri || '/';
        res.writeHead(302, { Location: logoutUri });
        res.end();
        return;
    }

    // Todo lo demás → archivos estáticos
    const filePath = path.join(ROOT, pathname === '/' ? 'index.html' : pathname);
    serveStatic(res, filePath);
});

server.listen(PORT, () => {
    console.log('\n  Mock SSO server corriendo\n');
    console.log(`  TyC Sports  →  http://localhost:${PORT}/tycsports/`);
    console.log(`  Play        →  http://localhost:${PORT}/play/`);
    console.log(`  SSO Status  →  http://localhost:${PORT}/sso/`);
    console.log('\n  Login de prueba:');
    console.log('    Email:      test@tycsports.com');
    console.log('    Contraseña: cualquier valor\n');
});
