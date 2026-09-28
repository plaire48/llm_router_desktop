import { createRemoteJWKSet, jwtVerify } from 'jose';

export function identityConfig(env) {
  const guid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const fields = ['ENTRA_TENANT_ID', 'ENTRA_CLIENT_ID', 'ENTRA_ALLOWED_USER_ID'];
  for (const key of fields) if (!guid.test(env[key] ?? '')) throw new Error(`Configure ${key} as a GUID.`);
  return { tenant: env.ENTRA_TENANT_ID, audience: env.ENTRA_CLIENT_ID, user: env.ENTRA_ALLOWED_USER_ID, issuer: `https://login.microsoftonline.com/${env.ENTRA_TENANT_ID}/v2.0` };
}

export function createVerifier(config, keySet = createRemoteJWKSet(new URL(`https://login.microsoftonline.com/${config.tenant}/discovery/v2.0/keys`))) {
  return async header => {
    const match = /^Bearer ([A-Za-z0-9_.-]+)$/.exec(header ?? '');
    if (!match || match[1].length > 16384) throw new Error('Unauthorized');
    const { payload } = await jwtVerify(match[1], keySet, { issuer: config.issuer, audience: config.audience, algorithms: ['RS256'], requiredClaims: ['exp', 'iat', 'oid', 'tid', 'scp'] });
    if (payload.tid !== config.tenant || payload.oid !== config.user || typeof payload.scp !== 'string' || !payload.scp.split(' ').includes('access_as_user')) throw new Error('Unauthorized');
    return { user: payload.oid };
  };
}
