import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ago, inr, kg } from '../api';
import { MaterialName, MaterialPhoto } from '../components/MaterialTag';
import {
  Button, Empty, ErrorNote, Field, Modal, PageHeader, Spinner, StatusBadge, useLoad, useToast,
} from '../components/ui';

const TABS = [
  ['inventory', 'In inventory'],
  ['listed,reserved', 'On the market'],
  ['sold,reused,recycled,disposed', 'Closed'],
  ['', 'All'],
];

function PublishModal({ item, onClose, onDone }) {
  const navigate = useNavigate();
  const toast = useToast();
  const [price, setPrice] = useState(String(Math.round(item.estimatedPrice || item.ai?.suggestedPrice || 0)));
  const [description, setDescription] = useState(item.notes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const suggested = item.ai?.suggestedPrice || item.estimatedPrice;

  async function publish(e) {
    e.preventDefault();
    setBusy(true);
    try {
      await api('/listings', { method: 'POST', body: { materialId: item._id, price: Number(price), description } });
      toast('Published to the marketplace');
      onDone();
      navigate('/listings');
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`Publish "${item.title}"`} onClose={onClose}>
      <form onSubmit={publish} className="space-y-4">
        <Field label="Asking price (₹)" hint={suggested ? `Suggested ${inr(suggested)} for ${kg(item.quantityKg)}. Keeping it counts towards the price-acceptance metric.` : undefined}>
          {(id) => <input id={id} type="number" min="0" required className="field" value={price} onChange={(e) => setPrice(e.target.value)} />}
        </Field>
        <Field label="Description for buyers" hint="Grade, dimensions, pickup access, loading help available…">
          {(id) => <textarea id={id} rows={4} className="field" maxLength={2000} value={description} onChange={(e) => setDescription(e.target.value)} />}
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full">Publish listing</Button>
      </form>
    </Modal>
  );
}

function CloseModal({ item, onClose, onDone }) {
  const toast = useToast();
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState('');
  async function close(action) {
    setBusy(action);
    try {
      await api(`/materials/${item._id}/close`, { method: 'POST', body: { action } });
      toast(`Marked as ${action === 'Reuse' ? 'reused' : action === 'Recycle' ? 'recycled' : 'disposed'}`);
      onDone();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(null);
    }
  }
  return (
    <Modal title="Close without selling" onClose={onClose}>
      <p className="mb-4 text-sm text-graphite-600">
        Use this when “{item.title}” left the site another way. Reuse and recycling count towards landfill diversion; disposal counts against it.
      </p>
      <div className="grid gap-2">
        <Button variant="secondary" busy={busy === 'Reuse'} onClick={() => close('Reuse')}>Reused on one of our sites</Button>
        <Button variant="secondary" busy={busy === 'Recycle'} onClick={() => close('Recycle')}>Sent to a recycler</Button>
        <Button variant="danger" busy={busy === 'Dispose'} onClick={() => close('Dispose')}>Disposed to landfill</Button>
      </div>
      <div className="mt-3"><ErrorNote>{error}</ErrorNote></div>
    </Modal>
  );
}

export default function Inventory() {
  const [tab, setTab] = useState('inventory');
  const [publishing, setPublishing] = useState(null);
  const [closing, setClosing] = useState(null);
  const toast = useToast();
  const { data, error, loading, reload } = useLoad(() => api('/materials'), []);
  const statuses = tab ? tab.split(',') : null;
  const items = (data?.items || []).filter((m) => !statuses || statuses.includes(m.status));

  async function remove(m) {
    if (!window.confirm(`Delete "${m.title}" from inventory?`)) return;
    try {
      await api(`/materials/${m._id}`, { method: 'DELETE' });
      toast('Deleted');
      reload();
    } catch (err) {
      toast(err.message, 'error');
    }
  }

  return (
    <>
      <PageHeader title="Inventory" actions={<Link to="/capture"><Button>Capture material</Button></Link>}>
        Everything you have recorded on site. Publish an item to sell it, or close it if it was reused, recycled or disposed.
      </PageHeader>
      <div role="tablist" className="mb-5 flex gap-1 overflow-x-auto border-b border-slab-300">
        {TABS.map(([v, label]) => (
          <button
            key={label}
            role="tab"
            aria-selected={tab === v}
            onClick={() => setTab(v)}
            className={`-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm font-semibold ${tab === v ? 'border-verdigris-600 text-verdigris-700' : 'border-transparent text-graphite-500 hover:text-graphite-800'}`}
          >
            {label}
            {data && <span className="ml-1.5 text-graphite-400">{(data.items || []).filter((m) => !v || v.split(',').includes(m.status)).length}</span>}
          </button>
        ))}
      </div>
      {loading && !data && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      {data && !items.length && (
        <Empty title={tab === 'inventory' ? 'Nothing waiting in inventory' : 'No items here'} action={tab === 'inventory' && <Link to="/capture"><Button>Capture material</Button></Link>}>
          {tab === 'inventory' ? 'Photograph salvageable material on site to get a condition score and price.' : null}
        </Empty>
      )}
      <ul className="divide-y divide-slab-300 border-y border-slab-300">
        {items.map((m) => (
          <li key={m._id} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center">
            <MaterialPhoto url={m.imageUrl} material={m.materialType} className="h-20 w-full shrink-0 rounded-md sm:w-28" />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate font-semibold">{m.title}</p>
                <StatusBadge status={m.status} />
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-graphite-600">
                <MaterialName material={m.materialType} />
                <span className="figure">{kg(m.quantityKg)}</span>
                <span>Condition {m.conditionScore}/100</span>
                {m.estimatedPrice != null && <span className="figure">{inr(m.estimatedPrice)}</span>}
                {m.ai?.recommendedAction && <span>AI suggests {m.ai.recommendedAction}{m.ai.demoMode ? ' (demo mode)' : ''}</span>}
                <span className="text-graphite-400">{ago(m.createdAt)}</span>
              </div>
            </div>
            {m.status === 'inventory' && (
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => setPublishing(m)}>Publish</Button>
                <Button size="sm" variant="secondary" onClick={() => setClosing(m)}>Close</Button>
                <Button size="sm" variant="ghost" onClick={() => remove(m)}>Delete</Button>
              </div>
            )}
            {['listed', 'reserved'].includes(m.status) && <Link to="/listings"><Button size="sm" variant="secondary">View listing</Button></Link>}
          </li>
        ))}
      </ul>
      {publishing && <PublishModal item={publishing} onClose={() => setPublishing(null)} onDone={reload} />}
      {closing && <CloseModal item={closing} onClose={() => setClosing(null)} onDone={reload} />}
    </>
  );
}
