import { describe, expect, it } from 'vitest';
import { renderEmail } from './index.js';

describe('renderEmail', () => {
  it('renders the verification email with the link in HTML and text', async () => {
    const e = await renderEmail('verifyEmail', {
      name: 'Mario',
      url: 'https://example.test/verify?t=1',
    });
    expect(e.subject).toBe('Conferma il tuo indirizzo email');
    expect(e.html).toContain('href="https://example.test/verify?t=1"');
    expect(e.html).toContain('lang="it"');
    expect(e.text).toContain('https://example.test/verify?t=1');
  });

  it('puts the step-up code in the subject', async () => {
    const e = await renderEmail('stepUpCode', { name: 'Mario', code: '123456' });
    expect(e.subject).toBe('123456 è il tuo codice di verifica');
    expect(e.text).toContain('123456');
  });
});
