// Auth — OAuth2 / Authorization Code + PKCE contra Cognito Hosted UI
// Vanilla JS puro, sin Amplify ni ninguna otra librería.
// Los usuarios federados (Google, Facebook) los maneja el Hosted UI nativamente —
// no se necesita Google SDK ni Facebook SDK en el cliente.

const Auth = (function () {

    const cfg  = () => window.AWS_CONFIG;

    // En el mockup las dos páginas comparten dominio (auth.tycsports.com),
    // por eso prefijamos las keys con el site. En prod cada dominio tiene
    // su propio localStorage y las keys se usan sin prefijo (igual que cognito-new).
    function storageKey(site, name) {
        const base = cfg().storage_keys[name] || name;
        return `${site}__${base}`;
    }

    function clientId(site) {
        const siteCfg = cfg().sites?.[site];
        if (!siteCfg?.client_id) throw new Error(`Site "${site}" no encontrado en AWS_CONFIG.sites`);
        return siteCfg.client_id;
    }

    function callbackUrl(site) {
        return `${cfg().redirect_base}/${site}/callback.html`;
    }

    function hostedUiBase() {
        const domain = cfg().aws_cognito_hosted_ui_domain;
        // En mock local el dominio ya incluye protocolo (http://localhost:...)
        if (domain.startsWith('http://') || domain.startsWith('https://')) return domain;
        return `https://${domain}`;
    }

    // — Login —
    // identityProvider: 'Google' | 'Facebook' | null (null = muestra pantalla de elección)
    async function login(site, identityProvider = null) {
        const { verifier, challenge, state } = await Pkce.generate();

        sessionStorage.setItem('pkce_verifier', verifier);
        sessionStorage.setItem('pkce_state',    state);
        sessionStorage.setItem('pkce_site',     site);

        const params = new URLSearchParams({
            response_type:         'code',
            client_id:             clientId(site),
            redirect_uri:          callbackUrl(site),
            scope:                 cfg().oauth_scopes,
            state,
            code_challenge:        challenge,
            code_challenge_method: 'S256',
        });

        if (identityProvider) {
            params.set('identity_provider', identityProvider);
        }

        const authorizeUrl = `${hostedUiBase()}/oauth2/authorize?${params}`;
        console.log('[Auth] login()', { site, clientId: clientId(site), redirectUri: callbackUrl(site), scope: cfg().oauth_scopes });
        console.log('[Auth] → Cognito URL:', authorizeUrl);
        window.location.href = authorizeUrl;
    }

    // — Callback — intercambia el authorization code por tokens
    async function handleCallback(site) {
        const params        = new URLSearchParams(window.location.search);
        const code          = params.get('code');
        const returnedState = params.get('state');
        const error         = params.get('error');

        console.log('[Auth] handleCallback()', {
            url:           window.location.href,
            code:          code ? code.slice(0, 12) + '…' : null,
            returnedState,
            error,
            errorDesc:     params.get('error_description'),
        });

        if (error) {
            const msg = params.get('error_description') || error;
            console.error('[Auth] Cognito devolvió error:', error, msg);
            throw new Error(`Cognito error: ${msg}`);
        }

        const storedState = sessionStorage.getItem('pkce_state');
        const verifier    = sessionStorage.getItem('pkce_verifier');

        console.log('[Auth] PKCE check:', {
            storedState,
            returnedState,
            match: returnedState === storedState,
            hasVerifier: !!verifier,
        });

        if (!code || returnedState !== storedState) {
            const detail = [
                `code: ${code ? 'presente' : 'ausente'}`,
                `state recibido: ${returnedState ?? 'ninguno'}`,
                `state esperado: ${storedState ?? 'ninguno (sessionStorage vacío)'}`,
            ].join(' | ');
            throw new Error(`Callback inválido — ${detail}`);
        }

        console.log('[Auth] Intercambiando code por tokens…');
        const tokenUrl = `${hostedUiBase()}/oauth2/token`;
        const res = await fetch(tokenUrl, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type:    'authorization_code',
                client_id:     clientId(site),
                redirect_uri:  callbackUrl(site),
                code,
                code_verifier: verifier,
            }),
        });

        console.log('[Auth] /oauth2/token response status:', res.status);

        if (!res.ok) {
            const err = await res.json().catch(() => ({}));
            console.error('[Auth] Token exchange error:', err);
            throw new Error(err.error_description || `Token exchange failed (${res.status})`);
        }

        const tokens = await res.json();
        console.log('[Auth] Tokens recibidos:', { access: !!tokens.access_token, id: !!tokens.id_token, refresh: !!tokens.refresh_token });
        _saveTokens(site, tokens);

        sessionStorage.removeItem('pkce_verifier');
        sessionStorage.removeItem('pkce_state');
        sessionStorage.removeItem('pkce_site');

        return tokens;
    }

    // — Sesión —
    function getSession(site) {
        const accessToken = localStorage.getItem(storageKey(site, 'access_token'));
        const expiry      = parseInt(localStorage.getItem(storageKey(site, 'token_expiry')) || '0');
        if (!accessToken || Date.now() >= expiry) return null;
        return {
            accessToken,
            idToken:      localStorage.getItem(storageKey(site, 'id_token')),
            refreshToken: localStorage.getItem(storageKey(site, 'refresh_token')),
            expiry,
        };
    }

    // Decodifica el payload del id_token (JWT) sin librería
    function getUser(site) {
        const session = getSession(site);
        if (!session || !session.idToken) return null;
        try {
            const b64     = session.idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
            const payload = JSON.parse(atob(b64));
            return {
                sub:      payload.sub,
                email:    payload.email,
                name:     payload.name || payload['cognito:username'] || payload.email,
                picture:  payload.picture || null,
                provider: payload.identities?.[0]?.providerName || 'Cognito',
            };
        } catch {
            return null;
        }
    }

    // — Refresh —
    async function refreshSession(site) {
        const refreshToken = localStorage.getItem(storageKey(site, 'refresh_token'));
        if (!refreshToken) return false;

        const res = await fetch(`${hostedUiBase()}/oauth2/token`, {
            method:  'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                grant_type:    'refresh_token',
                client_id:     clientId(site),
                refresh_token: refreshToken,
            }),
        });

        if (!res.ok) return false;

        const tokens = await res.json();
        _saveTokens(site, tokens);
        return true;
    }

    // — Logout —
    // Limpia el storage local Y redirige al endpoint /logout de Cognito
    // para invalidar la sesión del Hosted UI (SSO logout real).
    function logout(site) {
        const keys = cfg().storage_keys;
        Object.keys(keys).forEach(k => localStorage.removeItem(storageKey(site, k)));

        const params = new URLSearchParams({
            client_id:  clientId(site),
            logout_uri: `${cfg().redirect_base}/${site}/`,
        });

        window.location.href = `${hostedUiBase()}/logout?${params}`;
    }

    // — Privado —
    function _saveTokens(site, tokens) {
        localStorage.setItem(storageKey(site, 'access_token'),    tokens.access_token);
        localStorage.setItem(storageKey(site, 'id_token'),        tokens.id_token);
        if (tokens.refresh_token) {
            localStorage.setItem(storageKey(site, 'refresh_token'), tokens.refresh_token);
        }
        const expiry = Date.now() + (tokens.expires_in || 3600) * 1000;
        localStorage.setItem(storageKey(site, 'token_expiry'),    String(expiry));
        localStorage.setItem(storageKey(site, 'login_timestamp'), String(Math.floor(Date.now() / 1000)));
        if (tokens.id_token) {
            try {
                const b64     = tokens.id_token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
                const payload = JSON.parse(atob(b64));
                if (payload.picture) {
                    localStorage.setItem(storageKey(site, 'profile_pic'), payload.picture);
                }
                if (payload.sub) {
                    localStorage.setItem(storageKey(site, 'user_id'), payload.sub);
                }
            } catch { /* payload opcional */ }
        }
    }

    return { login, handleCallback, getSession, getUser, refreshSession, logout };

})();
