import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../auth';
import { Button, ErrorNote, Field } from '../components/ui';
import AuthShell from './AuthShell';

export default function Login() {
  const { login } = useAuth();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(form.email, form.password);
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <AuthShell title="Sign in">
      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label="Email">
          {(id) => <input id={id} type="email" autoComplete="email" required className="field" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />}
        </Field>
        <Field label="Password">
          {(id) => <input id={id} type="password" autoComplete="current-password" required className="field" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />}
        </Field>
        <ErrorNote>{error}</ErrorNote>
        <Button type="submit" busy={busy} className="w-full" size="lg">Sign in</Button>
      </form>
      <p className="mt-6 text-sm text-graphite-600">
        New here? <Link to="/register" className="font-semibold text-verdigris-700 underline-offset-2 hover:underline">Create an account</Link>
      </p>
    </AuthShell>
  );
}
