// PKCE — RFC 7636
// Vanilla JS puro, sin dependencias. Usa Web Crypto API (disponible en todos los browsers modernos y en S3/HTTPS).

const Pkce = (function () {

    function randomString(length) {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
        const array = new Uint8Array(length);
        crypto.getRandomValues(array);
        return Array.from(array, b => chars[b % chars.length]).join('');
    }

    async function codeChallenge(verifier) {
        const data   = new TextEncoder().encode(verifier);
        const digest = await crypto.subtle.digest('SHA-256', data);
        return btoa(String.fromCharCode(...new Uint8Array(digest)))
            .replace(/\+/g, '-')
            .replace(/\//g, '_')
            .replace(/=/g,  '');
    }

    async function generate() {
        const verifier   = randomString(128);
        const challenge  = await codeChallenge(verifier);
        const state      = randomString(32);
        return { verifier, challenge, state };
    }

    return { generate };

})();
