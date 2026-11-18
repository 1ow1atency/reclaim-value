import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ago, inr, kg } from '../api';
import { useAuth } from '../auth';
import { MATERIAL_NAMES, MaterialName, MaterialPhoto } from '../components/MaterialTag';
import {
  Button, Empty, ErrorNote, Field, PageHeader, Spinner, useLoad, useToast,
} from '../components/ui';

const CONDITIONS = [['', 'Any condition'], ['40', 'Fair or better (40+)'], ['60', 'Good or better (60+)'], ['80', 'Excellent (80+)']];
const DISTANCES = [10, 25, 50, 100, 500];
const BLANK = { materialType: '', minQuantityKg: '', maxPricePerKg: '', minCondition: '', maxDistanceKm: '50', city: '', note: '' };

function AlertForm({ onSaved }) {
  const { user, meta } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ ...BLANK, city: user.city || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });
  const ref = meta.materials?.[form.materialType];

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const r = await api('/wanted', { method: 'POST', body: form });
      const n = r.wanted.matchCount;
      toast(n ? `Alert saved. ${n} listing${n === 1 ? '' : 's'} already match.` : 'Alert saved. We will notify you when a match is listed.');
      setForm({ ...BLANK, city: form.city });
      onSaved(r.wanted._id);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={save} className="panel space-y-4 p-5">
      <h2 className="text-lg font-bold">New alert</h2>
      <Field label="Material">
        {(id) => (
          <select id={id} className="field" required value={form.materialType} onChange={set('materialType')}>
            <option value="">Choose a material</option>
            {Object.entries(MATERIAL_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        )}
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="At least (kg)" hint="Leave empty for any amount.">
          {(id) => <input id={id} type="number" min="0" inputMode="numeric" className="field" placeholder="2000" value={form.minQuantityKg} onChange={set('minQuantityKg')} />}
        </Field>
        <Field label="Up to (₹ per kg)" hint={ref ? `New ${MATERIAL_NAMES[form.materialType].toLowerCase()} is about ${inr(ref.pricePerKg)}/kg; scrap about ${inr(ref.scrapPerKg)}/kg.` : 'Leave empty for any price.'}>
          {(id) => <input id={id} type="number" min="0" step="0.1" inputMode="decimal" className="field" value={form.maxPricePerKg} onChange={set('maxPricePerKg')} />}
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Condition">
          {(id) => (
            <select id={id} className="field" value={form.minCondition} onChange={set('minCondition')}>
              {CONDITIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          )}
        </Field>
        <Field label="Within">
          {(id) => (
            <select id={id} className="field" value={form.maxDistanceKm} onChange={set('maxDistanceKm')}>
              {DISTANCES.map((d) => <option key={d} value={d}>{d} km</option>)}
            </select>
          )}
        </Field>
      </div>
      <Field label="Of" hint={form.city ? null : 'Without a city, distance cannot be checked.'}>
        {(id) => (
          <select id={id} className="field" value={form.city} onChange={set('city')}>
            <option value="">No city</option>
            {meta.cities.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
      </Field>
      <Field label="Note for suppliers (optional)" hint="Suppliers see this on the Buyer demand page. Your name is not shown.">
        {(id) => <input id={id} className="field" maxLength={300} placeholder="For a boundary wall, can collect" value={form.note} onChange={set('note')} />}
      </Field>
      <ErrorNote>{error}</ErrorNote>
      <Button type="submit" busy={busy} className="w-full">Save alert</Button>
    </form>
  );
}

function Matches({ id }) {
  const { data, error, loading } = useLoad(() => api(`/wanted/${id}/matches`), [id]);
  if (loading) return <div className="px-4 pb-4"><Spinner label="Finding matches" /></div>;
  if (error) return <div className="px-4 pb-4"><ErrorNote>{error}</ErrorNote></div>;
  if (!data.items.length) return <p className="px-4 pb-4 text-sm text-graphite-500">No live listings match yet. You will get a notification when one is published.</p>;
  return (
    <ul className="divide-y divide-slab-200 border-t border-slab-200">
      {data.items.map((l) => (
        <li key={l._id}>
          <Link to={`/marketplace?listing=${l._id}`} className="flex items-center gap-3 px-4 py-3 hover:bg-slab-100">
            <MaterialPhoto url={l.imageUrl} material={l.materialType} className="h-12 w-16 shrink-0 rounded" label={false} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-semibold">{l.title}</p>
              <p className="text-sm text-graphite-600">
                <span className="figure">{kg(l.quantityKg)}</span>, <span className="figure">{inr(l.price)}</span> ({inr(l.price / l.quantityKg)}/kg)
                {l.city ? `, ${l.city}` : ''}{l.distanceKm != null ? ` ${l.distanceKm} km` : ''}
              </p>
            </div>
            <span className="text-sm font-semibold text-verdigris-700">View</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export default function Wanted() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api('/wanted'), []);
  const [openId, setOpenId] = useState(null);
  const [busy, setBusy] = useState(null);

  async function toggle(w) {
    setBusy(w._id);
    try {
      await api(`/wanted/${w._id}`, { method: 'PATCH', body: { active: !w.active } });
      toast(w.active ? 'Alert paused' : 'Alert resumed');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  }
  async function remove(w) {
    setBusy(w._id);
    try {
      await api(`/wanted/${w._id}`, { method: 'DELETE' });
      toast('Alert deleted');
      if (openId === w._id) setOpenId(null);
      reload();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="Wanted alerts">
        Tell suppliers what you need. When a matching listing is published you get a notification, and suppliers holding matching stock are asked to list it.
      </PageHeader>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-label="Your alerts" className="order-2 lg:order-1">
          {loading && !data && <Spinner />}
          <ErrorNote>{error}</ErrorNote>
          {data && !data.items.length && (
            <Empty title="No alerts yet">Create one with the form. For example: bricks, at least 2,000 kg, up to ₹3.5/kg, within 50 km.</Empty>
          )}
          <ul className="space-y-3">
            {data?.items.map((w) => (
              <li key={w._id} className={`panel overflow-hidden ${w.active ? '' : 'opacity-70'}`}>
                <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <MaterialName material={w.materialType} />
                      {!w.active && <span className="rounded-full border border-slab-400 px-2 py-0.5 text-xs font-semibold text-graphite-500">Paused</span>}
                    </div>
                    <p className="mt-1 text-sm text-graphite-700">{w.summary}</p>
                    {w.note && <p className="mt-1 text-sm text-graphite-500">“{w.note}”</p>}
                    <p className="mt-1 text-xs text-graphite-400">Created {ago(w.createdAt)}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {w.active && (
                      <Button size="sm" variant={w.matchCount ? 'primary' : 'secondary'} onClick={() => setOpenId(openId === w._id ? null : w._id)} aria-expanded={openId === w._id}>
                        {w.matchCount} match{w.matchCount === 1 ? '' : 'es'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" busy={busy === w._id} onClick={() => toggle(w)}>{w.active ? 'Pause' : 'Resume'}</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(w)} disabled={busy === w._id}>Delete</Button>
                  </div>
                </div>
                {openId === w._id && w.active && <Matches id={w._id} />}
              </li>
            ))}
          </ul>
        </section>
        <div className="order-1 lg:order-2">
          <AlertForm onSaved={(id) => { reload(); setOpenId(id); }} />
        </div>
      </div>
    </>
  );
}
