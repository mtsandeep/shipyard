import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db';
import { account, session, user, verification } from '../db/schema';

const authOrigin = process.env.BETTER_AUTH_URL
  ? new URL(process.env.BETTER_AUTH_URL).origin
  : undefined;

export const auth = betterAuth({
  appName: 'ShipYard',
  baseURL: authOrigin!,
  basePath: '/api/auth',
  secret: process.env.BETTER_AUTH_SECRET!,
  trustedOrigins: [process.env.CLIENT_URL!].filter(Boolean),
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: {
      user,
      session,
      account,
      verification,
    },
  }),
  // Local/self-hosted login without a GitHub OAuth app.
  emailAndPassword: {
    enabled: true,
    autoSignIn: true,
  },
  socialProviders: {
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },
  advanced: {
    // Domain-scoped cookies only make sense on a real multi-subdomain setup;
    // host-only cookies are what localhost needs (cookies ignore ports).
    crossSubDomainCookies: {
      enabled: Boolean(authOrigin && !authOrigin.includes('//localhost')),
    },
    ipAddress: {
      ipAddressHeaders: ['x-forwarded-for', 'cf-connecting-ip', 'x-real-ip'],
    },
  },
});
