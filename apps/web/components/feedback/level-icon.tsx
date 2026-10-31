import { useTranslations } from 'next-intl';

/** SPEC §8.5: a note-shaped icon per level, told apart by colour (and by its label for screen readers). */
const COLORS: Record<string, string> = {
  NEWCOMER: '#6b7280',
  SESSION_PLAYER: '#15803d',
  SOLOIST: '#1d4ed8',
  PROFESSIONAL: '#7e22ce',
  MAESTRO: '#b45309',
  LEGEND: '#b91c1c',
};

export function LevelIcon({
  levelKey,
  className = 'size-4',
}: {
  levelKey: string | null;
  className?: string;
}) {
  const t = useTranslations('Reputation');
  if (!levelKey || !COLORS[levelKey]) return null;
  const label = t('level', { name: t(`levels.${levelKey as 'NEWCOMER'}`) });
  return (
    <svg viewBox="0 0 24 24" className={className} role="img" aria-label={label}>
      <title>{label}</title>
      <path fill={COLORS[levelKey]} d="M12 3v10.55A4 4 0 1 0 14 17V7h4V3h-6Z" />
    </svg>
  );
}
