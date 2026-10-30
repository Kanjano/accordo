import { defineRouting } from 'next-intl/routing';

export const routing = defineRouting({
  locales: ['it', 'en'],
  defaultLocale: 'it',
  // Italian URLs stay unprefixed (/annuncio/...); English is prepared under /en.
  localePrefix: 'as-needed',
});
