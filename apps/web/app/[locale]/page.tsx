import { Handshake, ShieldCheck, Star } from 'lucide-react';
import type { Locale } from 'next-intl';
import { getTranslations, setRequestLocale } from 'next-intl/server';

export default async function HomePage({ params }: PageProps<'/[locale]'>) {
  const { locale } = await params;
  setRequestLocale(locale as Locale);
  const t = await getTranslations('Home');
  const pillars = [
    { icon: ShieldCheck, title: t('protectedTitle'), text: t('protectedText') },
    { icon: Star, title: t('feedbackTitle'), text: t('feedbackText') },
    { icon: Handshake, title: t('safetyTitle'), text: t('safetyText') },
  ];

  return (
    <div className="mx-auto max-w-6xl px-4 py-12 sm:py-20">
      <section className="max-w-3xl">
        <h1 className="text-3xl font-bold tracking-tight text-balance sm:text-5xl">{t('title')}</h1>
        <p className="mt-4 text-lg text-muted-foreground text-pretty">{t('subtitle')}</p>
      </section>

      <section aria-labelledby="pillars" className="mt-14">
        <h2 id="pillars" className="sr-only">
          {t('pillars')}
        </h2>
        <ul className="grid gap-4 sm:grid-cols-3">
          {pillars.map(({ icon: Icon, title, text }) => (
            <li key={title} className="rounded-xl border bg-card p-6">
              <Icon aria-hidden className="size-6 text-primary" />
              <h3 className="mt-3 font-semibold">{title}</h3>
              <p className="mt-1 text-sm text-muted-foreground">{text}</p>
            </li>
          ))}
        </ul>
      </section>

      <p className="mt-14 text-sm text-muted-foreground">{t('comingSoon')}</p>
    </div>
  );
}
