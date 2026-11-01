export type MessageFlag =
  | 'LINK'
  | 'PHONE'
  | 'EMAIL'
  | 'IBAN'
  | 'OFF_PLATFORM_PAYMENT'
  | 'MESSAGING_APP';

export interface ScanResult {
  flags: MessageFlag[];
  /** Text with phone numbers and emails replaced by a mask. */
  maskedText: string;
  /** Links found (never rendered clickable unless on the platform domain). */
  links: { url: string; internal: boolean }[];
  /** Flags that require the "pay only with protected payment" warning to the recipient. */
  warnRecipient: boolean;
}

export const CONTACT_MASK = '[contatto nascosto]';

const DIGIT_WORDS = 'zero|uno|due|tre|quattro|cinque|sei|sette|otto|nove';
const DIGIT_WORD_VALUE: Record<string, string> = {
  zero: '0',
  uno: '1',
  due: '2',
  tre: '3',
  quattro: '4',
  cinque: '5',
  sei: '6',
  sette: '7',
  otto: '8',
  nove: '9',
};
// A digit run, or a spelled-out digit; separated by spaces, dots, dashes, slashes or brackets.
const NUM_TOKEN = `(?:\\d+|(?:${DIGIT_WORDS})\\b)`;
const PHONE_RE = new RegExp(
  `(?<![\\w@])(?:(?:\\+|00)\\s*39[\\s./-]*)?${NUM_TOKEN}(?:[\\s./()-]{0,3}${NUM_TOKEN}){1,15}`,
  'giu',
);

const AT = String.raw`(?:@|\s*[([]\s*at\s*[)\]]\s*|\s+at\s+|\s*chiocciola\s*)`;
const DOT = String.raw`(?:\.|\s*[([]\s*(?:dot|punto)\s*[)\]]\s*|\s+(?:dot|punto)\s+)`;
const TLD = '(?:com|it|net|org|eu|info|me|io|biz|de|fr|uk|es|ch)';
const EMAIL_RE = new RegExp(
  String.raw`[\p{L}\p{N}._%+-]+${AT}[\p{L}\p{N}-]+(?:${DOT}[\p{L}\p{N}-]+)*${DOT}${TLD}\b`,
  'giu',
);

const URL_RE = new RegExp(
  String.raw`\b(?:https?:\/\/[^\s<>"]+|www\.[^\s<>"]+|[a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)*(?:\.|\s+punto\s+)(?:${TLD}|ly|shop|store|link|app|xyz|online|site)\b(?:\/[^\s<>"]*)?)`,
  'giu',
);

const IBAN_RE = /\b[A-Z]{2}\s?\d{2}(?:\s?[A-Z0-9]){11,30}\b/giu;

const OFF_PLATFORM_RE =
  /\b(?:bonific\w*|ricaric\w*|postepay|western\s*union|money\s*gram|corriere\s+mio|mio\s+corriere|(?:pag\w*|soldi)\s+fuori|fuori\s+(?:dalla\s+)?(?:piattaforma|sito|app)|link\s+(?:per|da)\s+(?:ricevere|incassare)|ricevere\s+il\s+pagamento\s+(?:tramite|con)\s+link|paypal\s+amici|amici\s+e\s+(?:familiari|parenti)|carta\s+(?:per|da)\s+ricevere)\b/iu;
const MESSAGING_RE =
  /\b(?:whats\s*app|wa\.me|watsapp|telegram|t\.me|signal|viber|messenger|wechat|scrivimi\s+su)\b/iu;

function digitsOf(match: string): string {
  return match
    .toLowerCase()
    .replace(new RegExp(DIGIT_WORDS, 'g'), (w) => DIGIT_WORD_VALUE[w] ?? '')
    .replace(/\D/g, '');
}

function isPhone(match: string): boolean {
  const digits = digitsOf(match);
  // 9–13 digits: Italian mobiles (10), landlines (6–11) with prefix; prices and years are shorter.
  return digits.length >= 9 && digits.length <= 13;
}

/** IBAN with a valid mod-97 checksum (spaces allowed). */
export const isIban = (candidate: string) => {
  const compact = candidate.replace(/\s/g, '').toUpperCase();
  if (compact.length < 15 || compact.length > 34) return false;
  const rearranged = compact.slice(4) + compact.slice(0, 4);
  const numeric = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rem = 0;
  for (const ch of numeric) rem = (rem * 10 + Number(ch)) % 97;
  return rem === 1;
};

/**
 * SPEC §13.4 anti-scam scan, including obfuscations ("tre tre nove", "punto com", spaced digits).
 * `platformDomain` links are internal and may stay clickable.
 */
export function scanMessage(text: string, opts: { platformDomain?: string } = {}): ScanResult {
  const flags = new Set<MessageFlag>();
  const domain = opts.platformDomain?.toLowerCase();

  let masked = text.replace(EMAIL_RE, () => {
    flags.add('EMAIL');
    return CONTACT_MASK;
  });

  const ibanFound = [...masked.matchAll(IBAN_RE)].some((m) => isIban(m[0]));
  if (ibanFound) flags.add('IBAN');

  masked = masked.replace(PHONE_RE, (m) => {
    // IBANs are flagged separately and left visible: the recipient sees the warning.
    if (ibanFound && isIban(m)) return m;
    if (!isPhone(m)) return m;
    flags.add('PHONE');
    return CONTACT_MASK;
  });

  const links = [...masked.matchAll(URL_RE)].map((m) => {
    const url = m[0].replace(/[.,;:!?)]+$/, '');
    const host =
      url
        .replace(/^https?:\/\//i, '')
        .split(/[/?#]/)[0]
        ?.toLowerCase() ?? '';
    const internal = !!domain && (host === domain || host.endsWith(`.${domain}`));
    return { url, internal };
  });
  if (links.some((l) => !l.internal)) flags.add('LINK');
  if (OFF_PLATFORM_RE.test(text)) flags.add('OFF_PLATFORM_PAYMENT');
  if (MESSAGING_RE.test(text)) flags.add('MESSAGING_APP');

  const ordered = (
    ['LINK', 'PHONE', 'EMAIL', 'IBAN', 'OFF_PLATFORM_PAYMENT', 'MESSAGING_APP'] as const
  ).filter((f) => flags.has(f));
  return {
    flags: ordered,
    maskedText: masked,
    links,
    warnRecipient: ordered.some(
      (f) => f === 'IBAN' || f === 'OFF_PLATFORM_PAYMENT' || f === 'MESSAGING_APP' || f === 'LINK',
    ),
  };
}

/**
 * Phones and emails stay masked until both parties have written at least one message
 * and the sender's account is at least 7 days old.
 */
export function shouldMaskContacts(i: {
  bothPartiesHaveWritten: boolean;
  senderAccountAgeDays: number;
}): boolean {
  return !(i.bothPartiesHaveWritten && i.senderAccountAgeDays >= 7);
}

/** 5+ flagged messages in 24h towards different conversations → account LIMITED (SPEC §13.4). */
export function isSuspiciousMessagingPattern(
  flagged: ReadonlyArray<{ conversationId: string; createdAt: Date }>,
  now: Date,
): boolean {
  const since = now.getTime() - 86_400_000;
  return (
    new Set(flagged.filter((m) => m.createdAt.getTime() >= since).map((m) => m.conversationId))
      .size >= 5
  );
}
