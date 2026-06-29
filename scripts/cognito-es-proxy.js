/**
 * cognito-es-proxy.js — Proxy local que traduce el Cognito Managed Login al español.
 * Intercepta el HTML de Cognito e inyecta un script de traducción client-side.
 *
 * Uso: node scripts/cognito-es-proxy.js
 * URL: http://localhost:8083/oauth2/authorize?client_id=...
 */

const http  = require('http');
const https = require('https');
const url   = require('url');

const COGNITO_DOMAIN = 'tycsports-auth-2022-dev.auth.us-east-1.amazoncognito.com';
const PORT = 8083;

// ─── Script de traducción inyectado en el HTML de Cognito ─────────────────────

const TRANSLATION_SCRIPT = `
<script>
(function () {
  var DICT = {
    'Sign in':                         'Iniciar sesión',
    'Sign in to your account.':        'Iniciá sesión en tu cuenta.',
    'Email address':                   'Correo electrónico',
    'Next':                            'Siguiente',
    'New user?':                       '¿Nuevo usuario?',
    'Create an account':               'Crear una cuenta',
    'Password':                        'Contraseña',
    'Forgot your password?':           '¿Olvidaste tu contraseña?',
    'Back':                            'Volver',
    'Confirm':                         'Confirmar',
    'Verify':                          'Verificar',
    'Verification code':               'Código de verificación',
    'Incorrect username or password.': 'Usuario o contraseña incorrectos.',
    'User does not exist.':            'El usuario no existe.',
    'Enter your email':                'Ingresá tu email',
    'Enter your password':             'Ingresá tu contraseña',
    'Resend code':                     'Reenviar código',
    'Send code':                       'Enviar código',
    'Reset your password':             'Restablecer contraseña',
    'New password':                    'Nueva contraseña',
    'Confirm new password':            'Confirmar nueva contraseña',
    'Submit':                          'Enviar',
  };

  function walk(node) {
    if (!node) return;
    if (node.nodeType === 3) {
      var t = node.textContent.trim();
      if (t && DICT[t]) node.textContent = node.textContent.replace(t, DICT[t]);
    } else {
      for (var i = 0; i < node.childNodes.length; i++) walk(node.childNodes[i]);
    }
  }

  function run() { if (document.body) walk(document.body); }

  // Poll cada 300ms durante 10 segundos para atrapar renders de React
  var ticks = 0;
  var iv = setInterval(function() { run(); if (++ticks > 33) clearInterval(iv); }, 300);

  // MutationObserver como refuerzo
  var obs = new MutationObserver(run);
  function init() {
    run();
    obs.observe(document.body, { childList: true, subtree: true, characterData: true });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
<\/script>
`;

// ─── Proxy server ─────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const parsed = url.parse(req.url);
  const bodyChunks = [];

  req.on('data', chunk => bodyChunks.push(chunk));
  req.on('end', () => {
    const body = bodyChunks.length ? Buffer.concat(bodyChunks) : null;

    const options = {
      hostname: COGNITO_DOMAIN,
      port:     443,
      path:     parsed.path || '/',
      method:   req.method,
      headers:  {
        ...req.headers,
        host:              COGNITO_DOMAIN,
        'accept-encoding': 'identity',   // Sin compresión para poder modificar el body
      },
    };

    const proxyReq = https.request(options, proxyRes => {
      const resChunks = [];
      proxyRes.on('data', chunk => resChunks.push(chunk));
      proxyRes.on('end', () => {
        const buffer      = Buffer.concat(resChunks);
        const contentType = proxyRes.headers['content-type'] || '';

        // Reescribir redirects para que sigan pasando por el proxy
        const headers = { ...proxyRes.headers };
        if (headers['location']) {
          headers['location'] = headers['location'].replace(
            `https://${COGNITO_DOMAIN}`,
            `http://localhost:${PORT}`
          );
        }

        delete headers['content-security-policy'];

        if (contentType.includes('text/html')) {
          let html = buffer.toString('utf-8');

          // Quitar CSP en meta tags (además del header que ya borramos)
          html = html.replace(/<meta[^>]+http-equiv=["']Content-Security-Policy["'][^>]*>/gi, '');

          // Inyectar script antes del </body>
          html = html.includes('</body>')
            ? html.replace('</body>', TRANSLATION_SCRIPT + '</body>')
            : html + TRANSLATION_SCRIPT;

          delete headers['content-length'];
          delete headers['content-encoding'];
          headers['content-type']   = 'text/html; charset=utf-8';
          headers['content-length'] = Buffer.byteLength(html, 'utf-8').toString();

          res.writeHead(proxyRes.statusCode, headers);
          res.end(html, 'utf-8');
        } else {
          // JS, CSS, imágenes → pasan sin tocar
          res.writeHead(proxyRes.statusCode, headers);
          res.end(buffer);
        }
      });
    });

    proxyReq.on('error', err => {
      console.error('[proxy] Error:', err.message);
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('Proxy error: ' + err.message);
    });

    if (body) proxyReq.write(body);
    proxyReq.end();
  });
});

server.listen(PORT, () => {
  console.log('\n  Cognito ES Proxy corriendo\n');
  console.log(`  Abrí este URL en el browser:`);
  console.log(`  http://localhost:${PORT}/oauth2/authorize?client_id=1il902om386u01m1dme0mrj7lp&response_type=code&scope=openid%20email%20profile&redirect_uri=http://localhost:8080/tycsports/callback.html&code_challenge_method=S256&code_challenge=demo\n`);
});
