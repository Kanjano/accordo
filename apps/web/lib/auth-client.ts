import { passkeyClient } from '@better-auth/passkey/client';
import { adminClient, twoFactorClient, usernameClient } from 'better-auth/client/plugins';
import { createAuthClient } from 'better-auth/react';
import { notifySessionChanged } from './session';

/** Full Better Auth client: auth forms and security settings only. Session state: lib/session.ts. */
export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_API_URL,
  basePath: '/api/auth',
  plugins: [usernameClient(), twoFactorClient(), passkeyClient(), adminClient()],
  fetchOptions: {
    onSuccess: ({ request }) => {
      if (!String(request.url).includes('/get-session')) notifySessionChanged();
    },
  },
});
