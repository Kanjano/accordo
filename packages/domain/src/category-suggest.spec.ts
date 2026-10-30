import { describe, expect, it } from 'vitest';
import { suggestCategories } from './category-suggest.js';

const cats = [
  'chitarre-elettriche:Chitarre elettriche',
  'chitarre-acustiche:Chitarre acustiche',
  'bassi-elettrici:Bassi elettrici',
  'effetti-a-pedale:Effetti a pedale',
  'sintetizzatori:Sintetizzatori',
  'violini:Violini',
  'interfacce-audio:Interfacce audio',
  'batterie-elettroniche:Batterie elettroniche',
  'batterie-acustiche:Batterie acustiche',
].map((s, i) => ({
  id: String(i),
  slug: s.split(':')[0] as string,
  name: s.split(':')[1] as string,
}));

const slugs = (title: string) => suggestCategories(title, cats).map((c) => c.slug);

describe('suggestCategories', () => {
  it.each([
    ['Fender Stratocaster Player 2021', 'chitarre-elettriche'],
    ['Boss DS-1 distorsore / overdrive', 'effetti-a-pedale'],
    ['Synth Korg Minilogue XD', 'sintetizzatori'],
    ['Scheda audio Focusrite Scarlett', 'interfacce-audio'],
    ['Batteria elettronica Roland TD-17', 'batterie-elettroniche'],
    ['Violino 4/4 con archetto', 'violini'],
    ['Basso Squier Jazz Bass', 'bassi-elettrici'],
  ])('%s → %s', (title, slug) => expect(slugs(title)[0]).toBe(slug));

  it('falls back to word overlap with category names and caps the results', () => {
    expect(slugs('Chitarre vintage lotto')).toEqual(['chitarre-elettriche', 'chitarre-acustiche']);
    expect(suggestCategories('Chitarra elettrica acustica violino synth', cats)).toHaveLength(3);
  });

  it('returns nothing for unrelated titles', () => {
    expect(slugs('Oggetto misterioso')).toEqual([]);
  });
});
