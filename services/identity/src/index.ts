import { encodeScope, parseScope, type SessionScope } from "@kairos/authz";
import { hmac } from "@noble/hashes/hmac";
import { sha256 } from "@noble/hashes/sha256";

/**
 * @kairos/identity — scoped session keys for agents.
 *
 * A session key is a bearer token: `base64url(payload) . base64url(hmac)`,
 * where the payload is the JSON session scope. The gateway signs with a single
 * secret (`SESSION_KEY_SIGNING_SECRET`); verification recomputes the HMAC, so
 * a tampered scope fails closed — the token is simply rejected.
 */

export interface SessionKeyServiceOptions {
  /** The shared signing secret. Never exposed in a token. */
  secret: string;
  /** Default lifetime for issued keys, in seconds. */
  ttlSeconds?: number;
}

export interface SessionKeyService {
  /** Issue a signed token for a scope. */
  issue(scope: Omit<SessionScope, "expiresAt">, ttlSeconds?: number): { token: string; scope: SessionScope };
  /** Verify and decode a token. `null` for tampered, expired or malformed. */
  verify(token: string, now?: number): SessionScope | null;
}

const b64url = (bytes: Uint8Array) => Buffer.from(bytes).toString("base64url");
const fromB64url = (s: string) => Buffer.from(s, "base64url");

function sign(secret: string, payload: string): string {
  return b64url(hmac(sha256, new TextEncoder().encode(secret), new TextEncoder().encode(payload)));
}

export function createSessionKeyService(options: SessionKeyServiceOptions): SessionKeyService {
  if (!options.secret || options.secret.length < 16) {
    throw new Error("SESSION_KEY_SIGNING_SECRET must be at least 16 characters");
  }
  const defaultTtl = options.ttlSeconds ?? 3600;

  return {
    issue(scope, ttlSeconds = defaultTtl) {
      const full: SessionScope = { ...scope, expiresAt: Math.floor(Date.now() / 1000) + ttlSeconds };
      const payload = b64url(new TextEncoder().encode(encodeScope(full)));
      return { token: `${payload}.${sign(options.secret, payload)}`, scope: full };
    },

    verify(token, now = Date.now()) {
      const dot = token.indexOf(".");
      if (dot <= 0) return null;
      const payload = token.slice(0, dot);
      const sig = token.slice(dot + 1);
      const expected = sign(options.secret, payload);
      if (sig.length !== expected.length) return null;

      // Constant-time comparison — timing the HMAC would leak the secret.
      let diff = 0;
      for (let i = 0; i < sig.length; i += 1) {
        diff |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
      }
      if (diff !== 0) return null;

      let scope: SessionScope | null = null;
      try {
        scope = parseScope(new TextDecoder().decode(fromB64url(payload)));
      } catch {
        return null;
      }
      if (!scope) return null;
      if (now >= scope.expiresAt * 1000) return null;
      return scope;
    },
  };
}
