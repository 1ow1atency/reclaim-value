import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field } from '../components/ui';
import AuthShell from './AuthShell';

const ROLES = [
  ['Company', 'I run sites', 'List salvaged material from construction or demolition sites.'],
  ['Buyer', 'I buy material', 'Find reusable steel, timber, bricks and more nearby.'],
  ['Recycler', 'I recycle', 'Collect material that can no longer be reused.'],
];

export default function Register() {
  const { register, meta } = useAuth();
  const [form, setForm] = useState({ name: '', email: '', password: '', role: 'Company', organization: '', city: 'Patiala' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await register(form);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Create an account">
      <form onSubmit={submit} className="mt-6 space-y-4">
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-graphite-800">What do you do?</legend>
          <div className="grid gap-2">
            {ROLES.map(([value, title, desc]) => (
              <label key={value} className={`flex cursor-pointer gap-3 rounded-md border px-3 py-2.5 ${form.role === value ? 'border-verdigris-600 bg-verdigris-50' : 'border-slab-400 bg-white'}`}>
                <input type="radio" name="role" value={value} checked={form.role === value} onChange={set('role')} className="mt-1 accent-verdigris-600" />
                <span>
                  <span className="block font-semibold">{title}</span>
                  <span className="block text-sm text-graphite-500">{desc}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Your name">{(id) => <input id={id} required className="field" value={form.name} onChange={set('name')} autoComplete="name" />}</Field>
        <Field label={form.role === 'Company' ? 'Company name' : 'Organisation (optional)'}>
          {(id) => <input id={id} required={form.role === 'Company'} className="field" value={form.organization} onChange={set('organization')} autoComplete="organization" />}
        </Field>
        <Field label="City" hint="Used to measure distance to buyers and sellers.">
          {(id) => (
            <select id={id} className="field" value={form.city} onChange={set('city')}>
              {(meta.cities.length ? meta.cities : ['Patiala']).map((c) => <option key={c}>{c}</option>)}
            </select>
          )}
        </Field>
        <Field label="Email">{(id) => <input id={id} type="email" required className="field" value={form.email} onChange={set('email')} autoComplete="email" />}</Field>
        <Field label="Password" hint="At least 8 characters.">
          {(id) => <input id={id} type="password" minLength={8} required className="field" value={form.password} onChange={set('password')} autoComplete="new-password" />}
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full" size="lg">Create account</Button>
      </form>
      <p className="mt-6 text-sm text-graphite-600">
        Already registered? <Link to="/login" className="font-semibold text-verdigris-700 hover:underline">Sign in</Link>
      </p>
    </AuthShell>
  );
}
