import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ago } from '../api';
import { useAuth } from '../auth';
import { MATERIAL_NAMES, MaterialName } from '../components/MaterialTag';
import {
  Button, Empty, ErrorNote, PageHeader, Spinner, Stat, useLoad,
} from '../components/ui';

export default function Demand() {
  const { user } = useAuth();
  const { data, error, loading } = useLoad(() => api('/wanted/demand'), []);
  const [material, setMaterial] = useState('');
  const [nearOnly, setNearOnly] = useState(false);
  const items = (data?.items || [])
    .filter((w) => !material || w.materialType === material)
    .filter((w) => !nearOnly || w.inRange);
  const top = Object.entries(data?.byMaterial || {}).sort((a, b) => b[1].alerts - a[1].alerts);

  return (
    <>
      <PageHeader
        title="Buyer demand"
        actions={<Link to="/capture"><Button>Capture material</Button></Link>}
      >
        What buyers and recyclers are asking for right now. Publish matching stock and they are notified straight away. Buyer names stay private until they send you a request.
      </PageHeader>
      {loading && !data && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      {data && !data.total && (
        <Empty title="No open demand yet">When a buyer posts a Wanted alert it appears here, and you get a notification if you already hold matching stock.</Empty>
      )}
      {data?.total > 0 && (
        <>
          <div className="mb-6 grid grid-cols-2 gap-5 sm:grid-cols-4">
            <Stat value={data.total} label="Open alerts" />
            {top.slice(0, 3).map(([m, s]) => (
              <Stat key={m} value={s.alerts} label={MATERIAL_NAMES[m]} note={user.city ? `${s.inRange} within reach of ${user.city}` : null} />
            ))}
          </div>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <select aria-label="Material" className="field w-auto" value={material} onChange={(e) => setMaterial(e.target.value)}>
              <option value="">All materials</option>
              {Object.entries(MATERIAL_NAMES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            {user.city && (
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={nearOnly} onChange={(e) => setNearOnly(e.target.checked)} className="h-4 w-4 accent-verdigris-600" />
                Only buyers within reach of {user.city}
              </label>
            )}
            {!user.city && <p className="text-sm text-graphite-500">Set your city under Account to see which buyers are within reach.</p>}
          </div>
          {!items.length && <Empty title="Nothing matches these filters" />}
          <ul className="space-y-3">
            {items.map((w) => (
              <li key={w._id} className="panel flex flex-wrap items-start gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <MaterialName material={w.materialType} />
                    <span className="text-sm text-graphite-500">{w.buyerRole}, {ago(w.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-sm text-graphite-700">{w.summary}</p>
                  {w.note && <p className="mt-1 text-sm text-graphite-500">“{w.note}”</p>}
                </div>
                <p className={`text-sm font-semibold ${w.inRange ? 'text-verdigris-700' : 'text-graphite-500'}`}>
                  {w.distanceKm == null ? 'Distance unknown' : `${w.distanceKm} km from you${w.inRange ? ', within reach' : ', outside their range'}`}
                </p>
              </li>
            ))}
          </ul>
          <p className="mt-6 text-sm text-graphite-500">
            Have matching stock? <Link to="/inventory" className="font-semibold text-verdigris-700 hover:underline">Publish it from Inventory</Link> and matching buyers get a notification.
          </p>
        </>
      )}
    </>
  );
}
