import { inr, kg } from '../api';

// Each material gets a swatch that looks like the material itself. The name
// is always printed next to it, so colour is never the only cue.
export const SWATCH = {
  steel: '#6E7C87',
  concrete: '#A3A39C',
  brick: '#A9533A',
  wood: '#B07D45',
  tiles: '#E4DFD3',
  glass: '#A9D3DC',
};
export const MATERIAL_NAMES = {
  steel: 'Steel', concrete: 'Concrete', brick: 'Brick', wood: 'Timber', tiles: 'Tiles', glass: 'Glass',
};

export function Swatch({ material, size = 12 }) {
  return (
    <span
      aria-hidden
      className="inline-block shrink-0 rounded-sm ring-1 ring-inset ring-graphite-900/20"
      style={{ width: size, height: size, background: SWATCH[material] || '#ccc' }}
    />
  );
}

export function MaterialName({ material }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-sm font-semibold">
      <Swatch material={material} />
      {MATERIAL_NAMES[material] || material}
    </span>
  );
}

// Photo, or a material-coloured placeholder when no photo was uploaded.
export function MaterialPhoto({ url, material, className = '', label = true }) {
  if (url) return <img src={url} alt="" loading="lazy" className={`object-cover ${className}`} />;
  return (
    <div className={`grid place-items-center ${className}`} style={{ background: SWATCH[material] }}>
      {label && <span className="condensed text-base font-bold text-graphite-900/70">No photo</span>}
    </div>
  );
}

// The salvage tag: the yard tag a stock item would carry. Used for listings
// and for the AI inspection result.
export function SalvageTag({ material, title, quantityKg, conditionScore, conditionLabel, price, children, tone = 'yellow' }) {
  const bg = tone === 'yellow' ? 'bg-tag-400' : 'bg-white';
  return (
    <div className={`salvage-tag ${bg} py-3 pl-9 pr-4 text-graphite-900`}>
      <div className="flex items-center gap-2">
        <Swatch material={material} size={14} />
        <span className="text-xs font-bold">{MATERIAL_NAMES[material]}</span>
        {conditionScore != null && (
          <span className="ml-auto text-xs font-semibold">
            {conditionLabel}, {Math.round(conditionScore)}/100
          </span>
        )}
      </div>
      {title && <p className="condensed mt-1 text-lg font-bold leading-snug">{title}</p>}
      <div className="mt-1 flex items-baseline justify-between gap-3">
        {quantityKg != null && <span className="figure text-base font-semibold">{kg(quantityKg)}</span>}
        {price != null && <span className="figure text-xl font-bold">{inr(price)}</span>}
      </div>
      {children}
    </div>
  );
}
