import { describe, expect, it } from 'vitest';
import {
  CONTACT_MASK,
  isSuspiciousMessagingPattern,
  scanMessage,
  shouldMaskContacts,
} from './scan-message.js';

const flagsOf = (t: string) => scanMessage(t, { platformDomain: 'accordo.it' }).flags;

describe('scanMessage — Italian corpus', () => {
  it.each([
    ['Ciao, è ancora disponibile?', []],
    ['Posso passare sabato alle 15, ti va bene 1500 euro?', []],
    ['La chitarra è del 2019, pagata 1200 nel 2020', []],
    ['Misure 102 x 40 x 12 cm, peso 4,5 kg', []],
    ['chiamami al 339 1234567', ['PHONE']],
    ['tel. +39 02-1234-5678', ['PHONE']],
    ['3 3 9 1 2 3 4 5 6 7', ['PHONE']],
    ['il mio numero è tre tre nove uno due tre quattro cinque sei sette', ['PHONE']],
    ['scrivimi a mario.rossi@gmail.com', ['EMAIL']],
    ['mario.rossi chiocciola gmail punto com', ['EMAIL']],
    ['mario [at] libero [dot] it', ['EMAIL']],
    ['guarda qui https://bit.ly/abc123', ['LINK']],
    ['vai su www.offerte-strumenti.com', ['LINK']],
    ['cerca su strumentifacili punto com', ['LINK']],
    ['ecco il mio annuncio https://accordo.it/annuncio/fender-8K2F9Q1M', []],
    ['IBAN IT60 X054 2811 1010 0000 0123 456', ['IBAN']],
    ['fammi un bonifico e te lo spedisco', ['OFF_PLATFORM_PAYMENT']],
    ['pago con ricarica postepay', ['OFF_PLATFORM_PAYMENT']],
    ['mando il mio corriere a ritirarlo', ['OFF_PLATFORM_PAYMENT']],
    ['ti mando il link per ricevere il pagamento', ['OFF_PLATFORM_PAYMENT']],
    ['Western Union va bene?', ['OFF_PLATFORM_PAYMENT']],
    ['facciamo pagamento fuori dalla piattaforma', ['OFF_PLATFORM_PAYMENT']],
    ['scrivimi su whatsapp', ['MESSAGING_APP']],
    ['sono su Telegram', ['MESSAGING_APP']],
    ['contattami su wa.me/393391234567', ['LINK', 'PHONE', 'MESSAGING_APP']],
  ])('%s', (text, expected) => {
    expect(flagsOf(text)).toEqual(expected);
  });
});

describe('scanMessage — masking and links', () => {
  it('masks phones and emails, keeps the rest', () => {
    const r = scanMessage('Ciao! 339 123 4567 oppure mario@example.com, grazie');
    expect(r.maskedText).toBe(`Ciao! ${CONTACT_MASK} oppure ${CONTACT_MASK}, grazie`);
  });

  it('keeps IBANs visible but flags them for the warning', () => {
    const r = scanMessage('IT60X0542811101000000123456');
    expect(r.flags).toEqual(['IBAN']);
    expect(r.maskedText).toBe('IT60X0542811101000000123456');
    expect(r.warnRecipient).toBe(true);
  });

  it('ignores IBAN-shaped strings with a wrong checksum', () => {
    expect(scanMessage('IT61X0542811101000000123456').flags).not.toContain('IBAN');
  });

  it('marks platform links as internal', () => {
    const r = scanMessage('vedi https://www.accordo.it/x e https://evil.example/y.', {
      platformDomain: 'accordo.it',
    });
    expect(r.links).toEqual([
      { url: 'https://www.accordo.it/x', internal: true },
      { url: 'https://evil.example/y', internal: false },
    ]);
  });

  it('contacts alone do not trigger the payment warning', () => {
    expect(scanMessage('339 1234567').warnRecipient).toBe(false);
  });
});

describe('contact masking policy', () => {
  it('unmasks only after both wrote and the sender is 7+ days old', () => {
    expect(shouldMaskContacts({ bothPartiesHaveWritten: true, senderAccountAgeDays: 7 })).toBe(
      false,
    );
    expect(shouldMaskContacts({ bothPartiesHaveWritten: false, senderAccountAgeDays: 100 })).toBe(
      true,
    );
    expect(shouldMaskContacts({ bothPartiesHaveWritten: true, senderAccountAgeDays: 6 })).toBe(
      true,
    );
  });
});

describe('isSuspiciousMessagingPattern', () => {
  const now = new Date('2026-10-30T12:00:00Z');
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
  it('5 flagged messages to different conversations within 24h', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map((conversationId) => ({
      conversationId,
      createdAt: at(1),
    }));
    expect(isSuspiciousMessagingPattern(five, now)).toBe(true);
    expect(
      isSuspiciousMessagingPattern(
        [...five.slice(0, 4), { conversationId: 'a', createdAt: at(1) }],
        now,
      ),
    ).toBe(false);
    expect(
      isSuspiciousMessagingPattern(
        [...five.slice(0, 4), { conversationId: 'e', createdAt: at(25) }],
        now,
      ),
    ).toBe(false);
  });
});
