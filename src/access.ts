// Who may use the app, kept free of any Supabase import so it can be tested on its own.

// The single account allowed to sign in. Sign-ups on the Supabase project are closed (an invite is required),
// so this is a second check in the app, not the only one.
export const ALLOWED_EMAIL = 'zz-owner@crusadeandheresy.com';

export type Access = 'allowed' | 'offline-allowed' | 'sign-in' | 'wrong-account';

export interface AccessInput {
  email?: string | null;   // email of the stored session, if there is one
  online: boolean;         // navigator.onLine
  seenBefore: boolean;     // this device has completed a sign-in before
  networkError: boolean;   // the session check failed because the network was unreachable
}

// A valid session for the allowed account gets in. With no usable session, a device that has signed in before is
// let in while it is offline (a stored session can't be refreshed without a connection), so the app still opens at the table.
export function decideAccess(i: AccessInput): Access {
  if (i.email) return i.email.trim().toLowerCase() === ALLOWED_EMAIL ? 'allowed' : 'wrong-account';
  if (i.seenBefore && (!i.online || i.networkError)) return 'offline-allowed';
  return 'sign-in';
}
