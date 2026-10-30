import { passkeyClient } from '@better-auth/passkey/client';
import { adminClient, twoFactorClient, usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  basePath: '/api/auth',
  plugins: [usernameClient(), twoFactorClient(), passkeyClient(), adminClient()],
});

export const { useSession, signOut } = authClient;
