/**
 * Lee el .env y genera config.js en la raíz del proyecto.
 * No requiere la librería dotenv — usa un parser propio para evitar dependencias extra.
 *
 * Uso:
 *   node scripts/generate-config.js           (usa .env por defecto)
 *   node scripts/generate-config.js .env.prod (usa otro archivo)
 */

const fs   = require('fs');
const path = require('path');

const envFile = process.argv[2] || '.env';
const envPath = path.resolve(__dirname, '..', envFile);

if (!fs.existsSync(envPath)) {
    console.error(`\n  ERROR: No se encontró "${envFile}".`);
    console.error(`  Copiá .env.example a .env y completá los valores.\n`);
    process.exit(1);
}

// Parser mínimo de .env — soporta comentarios y comillas
function parseEnv(filePath) {
    return fs.readFileSync(filePath, 'utf8')
        .split('\n')
        .reduce((acc, line) => {
            line = line.trim();
            if (!line || line.startsWith('#')) return acc;
            const idx = line.indexOf('=');
            if (idx === -1) return acc;
            const key = line.slice(0, idx).trim();
            const val = line.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
            acc[key] = val;
            return acc;
        }, {});
}

const env = parseEnv(envPath);

function required(key) {
    if (!env[key]) {
        console.error(`\n  ERROR: Falta la variable "${key}" en ${envFile}.\n`);
        process.exit(1);
    }
    return env[key];
}

// — Configuración —
// Para agregar un sitio nuevo (ej: elgrafico):
//   1. Agregar AWS_CLIENT_ID_ELGRAFICO en .env
//   2. Agregar la entrada en `sites` acá abajo
//   3. Crear las páginas HTML del sitio nuevo

const config = {
    aws_cognito_region:           required('AWS_COGNITO_REGION'),
    aws_user_pools_id:            required('AWS_USER_POOLS_ID'),
    aws_cognito_hosted_ui_domain: required('AWS_COGNITO_HOSTED_UI_DOMAIN'),
    oauth_scopes:                 env.OAUTH_SCOPES || 'openid email profile',

    redirect_base_local: env.REDIRECT_BASE_LOCAL || 'http://localhost:8080',
    redirect_base_prod:  env.REDIRECT_BASE_PROD  || 'https://auth.tycsports.com',

    // Sites — solo se incluyen los que tienen client_id configurado en .env
    sites: Object.fromEntries(
        [
            ['tycsports', env.AWS_CLIENT_ID_TYCSPORTS],
            ['play',      env.AWS_CLIENT_ID_PLAY],
            // ['elgrafico',  env.AWS_CLIENT_ID_ELGRAFICO],
            // ['carburando', env.AWS_CLIENT_ID_CARBURANDO],
        ]
        .filter(([, id]) => id)
        .map(([site, id]) => {
            console.log(`  site configurado: ${site}`);
            return [site, { client_id: id }];
        })
    ),

    // localStorage keys — compatibles con cognito-new y frontend_24
    storage_keys: {
        login_timestamp: '_tyc_utslg',
        user_id:         'tycuid',
        profile_pic:     'ipu',
        access_token:    '_tyc_access',
        id_token:        '_tyc_id',
        refresh_token:   '_tyc_refresh',
        token_expiry:    '_tyc_exp',
    },
};

const output = `// AUTO-GENERADO — no editar manualmente.
// Modificá .env y ejecutá: npm run generate:config
(function () {
    const isLocal = ['localhost', '127.0.0.1'].includes(window.location.hostname);
    window.AWS_CONFIG = ${JSON.stringify(config, null, 4)};
    window.AWS_CONFIG.redirect_base = isLocal
        ? window.AWS_CONFIG.redirect_base_local
        : window.AWS_CONFIG.redirect_base_prod;
})();
`;

const outPath = path.resolve(__dirname, '..', 'config.js');
fs.writeFileSync(outPath, output, 'utf8');
console.log(`  config.js generado desde ${envFile}`);
