import { describe, expect, it } from 'vitest';
import { ALLOWED_EMAIL, decideAccess } from './access';

describe('decideAccess', () => {
  const base = { online: true, seenBefore: false, networkError: false };
  it('lets the allowed account in, ignoring case and spaces', () => {
    expect(decideAccess({ ...base, email: ALLOWED_EMAIL })).toBe('allowed');
    expect(decideAccess({ ...base, email: ' ' + ALLOWED_EMAIL.toUpperCase() + ' ' })).toBe('allowed');
  });
  it('rejects any other account', () => {
    expect(decideAccess({ ...base, email: 'someone@example.com' })).toBe('wrong-account');
  });
  it('shows sign-in when there is no session', () => {
    expect(decideAccess({ ...base, email: null })).toBe('sign-in');
    expect(decideAccess({ ...base, email: undefined })).toBe('sign-in');
  });
  it('a first-time device with no connection cannot get in', () => {
    expect(decideAccess({ ...base, email: null, online: false })).toBe('sign-in');
    expect(decideAccess({ ...base, email: null, networkError: true })).toBe('sign-in');
  });
  it('a device that signed in before opens offline', () => {
    expect(decideAccess({ ...base, email: null, seenBefore: true, online: false })).toBe('offline-allowed');
    expect(decideAccess({ ...base, email: null, seenBefore: true, networkError: true })).toBe('offline-allowed');
  });
  it('a device that signed in before still needs sign-in when online with no session', () => {
    expect(decideAccess({ ...base, email: null, seenBefore: true })).toBe('sign-in');
  });
  it('offline does not let a wrong account in', () => {
    expect(decideAccess({ ...base, email: 'someone@example.com', seenBefore: true, online: false })).toBe('wrong-account');
  });
});
