import { buttonVariants } from '@accordo/ui';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';

export default function NotFound() {
  const t = useTranslations('NotFound');
  const tc = useTranslations('Common');
  return (
    <div className="mx-auto grid max-w-xl gap-4 px-4 py-20 text-center">
      <h1 className="text-3xl font-bold">{t('title')}</h1>
      <p className="text-muted-foreground">{t('text')}</p>
      <Link href="/" className={buttonVariants({ className: 'justify-self-center' })}>
        {tc('backHome')}
      </Link>
    </div>
  );
}
