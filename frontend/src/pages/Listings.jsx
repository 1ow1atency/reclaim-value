import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ago, inr, kg } from '../api';
import { MaterialName, MaterialPhoto } from '../components/MaterialTag';
import {
  Button, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, StatusBadge, useLoad, useToast,
} from '../components/ui';

function BuyersModal({ listing, onClose }) {
  const { data, error, loading } = useLoad(() => api(`/listings/${listing._id}/buyers`), [listing._id]);
  return (
    <Modal title="Likely buyers" onClose={onClose}>
      <p className="mb-3 text-sm text-graphite-600">
        Ranked by interest in {listing.materialType} (from past requests), distance and rating. Recyclers rank higher for low-condition material.
      </p>
      {loading && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      {data && !data.items.length && <Empty title="No buyers registered yet" />}
      <ol className="divide-y divide-slab-200">
        {data?.items.map((b) => (
          <li key={b._id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
            <div>
              <p className="font-semibold">{b.organization || b.name}</p>
              <p className="text-graphite-500">{b.role}, {b.city || 'location unknown'}{b.distanceKm != null ? `, ${b.distanceKm} km` : ''}{b.pastRequests ? `, ${b.pastRequests} past requests` : ''}</p>
            </div>
            <span className="figure font-bold">{Math.round(b.score * 100)}%</span>
          </li>
        ))}
      </ol>
    </Modal>
  );
}

function PriceModal({ listing, onClose, onDone }) {
  const toast = useToast();
  const [price, setPrice] = useState(String(listing.price));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api(`/listings/${listing._id}`, { method: 'PATCH', body: { price: Number(price) } });
      toast('Price updated');
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }
  return (
    <Modal title="Change price" onClose={onClose}>
      <form onSubmit={save} className="space-y-4">
        <Field label="Asking price (₹)" hint={listing.suggestedPrice ? `AI suggested ${inr(listing.suggestedPrice)}` : undefined}>
          {(id) => <input id={id} type="number" min="0" className="field" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full">Save price</Button>
      </form>
    </Modal>
  );
}

export default function Listings() {
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api('/listings/mine'), []);
  const [buyersFor, setBuyersFor] = useState(null);
  const [pricing, setPricing] = useState(null);

  async function setStatus(l, status) {
    try {
      await api(`/listings/${l._id}`, { method: 'PATCH', body: { status } });
      toast(status === 'withdrawn' ? 'Withdrawn, item is back in inventory' : 'Listing is live again');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader title="Your listings">Material you have put on the marketplace. Requests from buyers appear under Requests.</PageHeader>
      {loading && !data && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      {data && !data.items.length && (
        <Empty title="No listings yet" action={<Link to="/inventory"><Button>Go to inventory</Button></Link>}>Publish an item from your inventory to make it visible to buyers.</Empty>
      )}
      <ul className="grid gap-4 md:grid-cols-2">
        {data?.items.map((l) => (
          <li key={l._id} className="panel flex gap-4 p-3">
            <MaterialPhoto url={l.imageUrl} material={l.materialType} className="h-24 w-24 shrink-0 rounded-md" />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold leading-snug">{l.title}</p>
                <StatusBadge status={l.status} />
              </div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-sm text-graphite-600">
                <MaterialName material={l.materialType} />
                <span className="figure">{kg(l.quantityKg)}</span>
                <span className="figure font-semibold text-graphite-900">{inr(l.price)}</span>
              </div>
              <p className="mt-1 text-xs text-graphite-400">
                Published {ago(l.publishedAt)}
                {l.pendingRequests ? `, ${l.pendingRequests} request${l.pendingRequests > 1 ? 's' : ''} waiting` : ''}
              </p>
              <div className="mt-2 flex flex-wrap gap-1">
                {l.pendingRequests > 0 && <Link to="/requests"><Button size="sm">Answer requests</Button></Link>}
                {l.status === 'active' && (
                  <>
                    <Button size="sm" variant="secondary" onClick={() => setBuyersFor(l)}>Likely buyers</Button>
                    <Button size="sm" variant="ghost" onClick={() => setPricing(l)}>Change price</Button>
                    <Button size="sm" variant="ghost" onClick={() => setStatus(l, 'withdrawn')}>Withdraw</Button>
                  </>
                )}
                {l.status === 'withdrawn' && l.material && <Button size="sm" variant="secondary" onClick={() => setStatus(l, 'active')}>Relist</Button>}
              </div>
            </div>
          </li>
        ))}
      </ul>
      {buyersFor && <BuyersModal listing={buyersFor} onClose={() => setBuyersFor(null)} />}
      {pricing && <PriceModal listing={pricing} onClose={() => setPricing(null)} onDone={reload} />}
    </>
  );
}
