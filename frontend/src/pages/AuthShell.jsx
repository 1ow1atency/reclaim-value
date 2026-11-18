import { Logo } from '../components/Layout';
import { SalvageTag } from '../components/MaterialTag';

// Split screen: the product idea on the left as a real tag, form on the right.
export default function AuthShell({ title, children }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <section className="relative hidden flex-col justify-between overflow-hidden bg-verdigris-800 p-10 text-white lg:flex">
        <Logo dark />
        <div className="max-w-md">
          <h2 className="text-4xl font-extrabold leading-none">Demolition waste is stock that hasn&apos;t been counted yet.</h2>
          <p className="mt-4 text-lg text-verdigris-100/80">
            Photograph what a site can give back. Get a condition score, a fair price and the nearest buyer, and see how much landfill you avoided.
          </p>
          <div className="mt-10 max-w-sm -rotate-2">
            <SalvageTag material="steel" title="ISMB 200 I-beams, 6 m lengths" quantityKg={1200} conditionScore={84} conditionLabel="Excellent" price={49800}>
              <p className="mt-2 border-t border-graphite-900/20 pt-2 text-sm">Suggested action: <strong>Sell</strong>. Saves about 2.2 t CO₂e.</p>
            </SalvageTag>
          </div>
        </div>
        <p className="text-sm text-verdigris-100/60">A circular marketplace for construction and demolition material.</p>
      </section>
      <section className="flex flex-col justify-center px-5 py-10 sm:px-12">
        <div className="mx-auto w-full max-w-sm">
          <div className="mb-8 lg:hidden"><Logo /></div>
          <h1 className="text-3xl font-bold">{title}</h1>
          {children}
        </div>
      </section>
    </div>
  );
}
