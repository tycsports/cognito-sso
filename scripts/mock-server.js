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
<title>Mock Cognito — Login</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
         background: #1a1a2e; color: #fff; min-height: 100vh;
         display: flex; align-items: center; justify-content: center; }
  .card { background: #16213e; border-radius: 12px; padding: 40px 36px; width: 360px; }
  .card h2 { font-size: 20px; margin-bottom: 6px; }
  .badge { display: inline-block; background: #e65c00; color: #fff;
           font-size: 11px; padding: 2px 8px; border-radius: 4px; margin-bottom: 24px; }
  label { display: block; font-size: 12px; color: #aaa; margin: 14px 0 4px; }
  input[type=email], input[type=password] {
    width: 100%; padding: 10px; border-radius: 6px;
    border: 1px solid #2a3a5c; background: #0f3460; color: #fff; font-size: 14px; }
  .btn-main { width: 100%; margin-top: 22px; padding: 12px; background: #e94560;
              color: #fff; border: none; border-radius: 6px;
              font-size: 15px; font-weight: 600; cursor: pointer; }
  .btn-main:hover { background: #c73852; }
  .divider { text-align: center; color: #555; margin: 18px 0; font-size: 13px; }
  .social { display: flex; gap: 8px; }
  .social button { flex: 1; padding: 10px; background: #1a2540; color: #ccc;
                   border: 1px solid #2a3a5c; border-radius: 6px;
                   font-size: 13px; cursor: pointer; }
  .social button:hover { border-color: #4da6ff; color: #fff; }
</style>
</head>
<body>
<div class="card">
  <h2>Iniciar sesión</h2>
  <span class="badge">MOCK — sin AWS</span>

  <form method="POST">
    <input type="hidden" name="redirect_uri" value="${redirectUri}">
    <input type="hidden" name="state" value="${state}">
    <input type="hidden" name="provider" value="Cognito">
    <label>Email</label>
    <input type="email" name="email" value="test@tycsports.com" required>
    <label>Contraseña</label>
    <input type="password" name="password" placeholder="cualquier valor" required>
    <button class="btn-main" type="submit">Iniciar sesión</button>
  </form>

  <div class="divider">o continuar con</div>

  <div class="social">
    <form method="POST">
      <input type="hidden" name="redirect_uri" value="${redirectUri}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="email" value="google.user@gmail.com">
      <input type="hidden" name="name" value="Usuario Google">
      <input type="hidden" name="provider" value="Google">
      <button type="submit">Google</button>
    </form>
    <form method="POST">
      <input type="hidden" name="redirect_uri" value="${redirectUri}">
      <input type="hidden" name="state" value="${state}">
      <input type="hidden" name="email" value="fb.user@facebook.com">
      <input type="hidden" name="name" value="Usuario Facebook">
      <input type="hidden" name="provider" value="Facebook">
      <button type="submit">Facebook</button>
    </form>
  </div>
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
