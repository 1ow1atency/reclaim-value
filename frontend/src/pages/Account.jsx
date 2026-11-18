import { useState } from 'react';
import { api } from '../api';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field, PageHeader, useToast } from '../components/ui';

export default function Account() {
  const { user, setUser, meta, logout } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState({ name: user.name, organization: user.organization || '', city: user.city || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const d = await api('/auth/me', { method: 'PATCH', body: form });
      setUser(d.user);
      toast('Account saved');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader title="Account">{user.email}, {user.role} account. Your rating: {user.rating?.toFixed(1)}/5.</PageHeader>
      <form onSubmit={save} className="max-w-md space-y-4">
        <Field label="Name">{(id) => <input id={id} className="field" required value={form.name} onChange={set('name')} />}</Field>
        <Field label="Organisation">{(id) => <input id={id} className="field" value={form.organization} onChange={set('organization')} />}</Field>
        <Field label="City" hint="Distances in search and matching are measured from here.">
          {(id) => (
            <select id={id} className="field" value={form.city} onChange={set('city')}>
              <option value="">Choose a city</option>
              {meta.cities.map((c) => <option key={c}>{c}</option>)}
            </select>
          )}
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <div className="flex gap-2">
          <Button type="submit" busy={busy}>Save changes</Button>
          <Button type="button" variant="secondary" onClick={logout}>Sign out</Button>
        </div>
      </form>
    </>
  );
}
