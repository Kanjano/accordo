const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Trade vocabulary → category slug (SPEC §3.3: category suggested from the title). */
const KEYWORDS: ReadonlyArray<[RegExp, string]> = [
  [
    /\b(strat\w*|tele(caster)?|les ?paul|sg|superstrat|chitarra elettrica|elettrica)\b/,
    'chitarre-elettriche',
  ],
  [/\b(semiacustica|hollow ?body|es-?335)\b/, 'semiacustiche'],
  [/\b(dreadnought|jumbo|chitarra acustica|acustica)\b/, 'chitarre-acustiche'],
  [/\b(chitarra classica|classica)\b/, 'chitarre-classiche'],
  [/\b(basso|bass|precision|jazz bass|p-?bass|j-?bass)\b/, 'bassi-elettrici'],
  [/\b(testata|combo|ampli\w*|cassa \dx1?\d)\b/, 'amplificatori-chitarra'],
  [
    /\b(pedale|overdrive|distorsore|fuzz|delay|riverbero|reverb|chorus|wah|looper|compressore)\b/,
    'effetti-a-pedale',
  ],
  [/\b(multieffett\w*|modeler|helix|kemper|quad ?cortex|pedaliera)\b/, 'multieffetti-modeler'],
  [/\b(pickup|humbucker|single coil|ponte|meccaniche|manico)\b/, 'parti-ricambi-chitarra'],
  [/\b(synth\w*|sintetizzator\w*|moog|prophet|minilogue)\b/, 'sintetizzatori'],
  [/\b(piano(forte)? digitale|stage piano|clavinova)\b/, 'pianoforti-digitali'],
  [/\b(pianoforte|piano verticale|piano a coda)\b/, 'pianoforti-acustici'],
  [/\b(workstation)\b/, 'workstation'],
  [/\b(arranger)\b/, 'tastiere-arranger'],
  [/\b(master ?keyboard|controller midi|tastiera midi)\b/, 'master-keyboard-controller'],
  [/\b(organo|hammond)\b/, 'organi'],
  [/\b(fisarmonica)\b/, 'fisarmoniche'],
  [/\b(batteria elettronica|e-?drum|td-?\d+)\b/, 'batterie-elettroniche'],
  [/\b(batteria|drum ?kit)\b/, 'batterie-acustiche'],
  [/\b(piatt[oi]|ride|crash|hi-?hat|charleston|splash)\b/, 'piatti'],
  [/\b(rullante|snare)\b/, 'rullanti'],
  [/\b(cajon|djembe|bongo|conga)\b/, 'percussioni-a-mano'],
  [/\b(sax\w*|contralto|tenore)\b/, 'sassofoni'],
  [/\b(tromba|cornetta)\b/, 'trombe-cornette'],
  [/\b(trombone)\b/, 'tromboni'],
  [/\b(clarinetto)\b/, 'clarinetti'],
  [/\b(flauto traverso|flauto)\b/, 'flauti-traversi'],
  [/\b(armonica)\b/, 'armoniche'],
  [/\b(violino)\b/, 'violini'],
  [/\b(viola)\b/, 'viole'],
  [/\b(violoncello|cello)\b/, 'violoncelli'],
  [/\b(contrabbasso)\b/, 'contrabbassi'],
  [/\b(ukulele)\b/, 'ukulele'],
  [/\b(mandolino)\b/, 'mandolini'],
  [/\b(scheda audio|interfaccia audio|audio interface)\b/, 'interfacce-audio'],
  [/\b(microfon\w*|mic)\b/, 'microfoni'],
  [/\b(monitor da studio|monitor studio|casse monitor)\b/, 'monitor-studio'],
  [/\b(cuffi[ae])\b/, 'cuffie'],
  [/\b(mixer digitale)\b/, 'mixer-digitali'],
  [/\b(mixer)\b/, 'mixer-analogici'],
  [/\b(cassa attiva|diffusor\w* attiv\w*)\b/, 'diffusori-attivi'],
  [/\b(subwoofer|cassa passiva)\b/, 'diffusori-passivi-subwoofer'],
  [/\b(finale di potenza|amplificatore di potenza)\b/, 'finali-di-potenza'],
  [/\b(radiomicrofon\w*|wireless)\b/, 'radiomicrofoni'],
  [/\b(controller dj|ddj-?\w*)\b/, 'controller-dj'],
  [/\b(console dj|xdj-?\w*)\b/, 'console-dj'],
  [/\b(giradischi|technics 1210|turntable)\b/, 'giradischi'],
  [/\b(cdj|lettore cd)\b/, 'media-player'],
  [/\b(testa mobile|teste mobili|moving head)\b/, 'teste-mobili'],
  [/\b(par led|faro)\b/, 'fari-par-led'],
  [/\b(macchina del fumo|hazer|fog)\b/, 'macchine-fumo-haze'],
  [/\b(vinile|lp|33 giri|45 giri)\b/, 'vinili'],
  [/\b(spartit\w*|metodo)\b/, 'spartiti-metodi'],
  [/\b(maglietta|t-?shirt|felpa)\b/, 'abbigliamento'],
];

export interface SuggestableCategory {
  id: string;
  slug: string;
  name: string;
}

/**
 * Up to `limit` categories for a listing title: trade keywords first, then word overlap with
 * category names (5-letter stems, so "chitarre" matches "chitarra").
 */
export function suggestCategories<T extends SuggestableCategory>(
  title: string,
  categories: readonly T[],
  limit = 3,
): T[] {
  const text = fold(title);
  const bySlug = new Map(categories.map((c) => [c.slug, c]));
  const out: T[] = [];
  const add = (c: T | undefined) => {
    if (c && !out.includes(c) && out.length < limit) out.push(c);
  };
  for (const [re, slug] of KEYWORDS) if (re.test(text)) add(bySlug.get(slug));

  const stems = new Set(
    text
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length >= 4)
      .map((w) => w.slice(0, 5)),
  );
  const scored = categories
    .map((c) => ({
      c,
      score: fold(c.name)
        .split(/[^a-z0-9]+/)
        .filter((w) => w.length >= 4 && stems.has(w.slice(0, 5))).length,
    }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  for (const { c } of scored) add(c);
  return out;
}
