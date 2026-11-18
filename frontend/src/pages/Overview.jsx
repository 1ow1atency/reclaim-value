import { Link } from 'react-router-dom';
import { api, inr, kg } from '../api';
import { useAuth } from '../auth';
import Chat from '../components/Chat';
import { Button, ErrorNote, PageHeader, Spinner, Stat, useLoad } from '../components/ui';

function CompanyOverview({ s }) {
  const pending = s.counts.requests?.pending || 0;
  return (
    <>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat value={s.counts.inInventory} label="Items waiting in inventory" />
        <Stat value={s.counts.activeListings} label="Live listings" />
        <Stat value={kg(s.divertedKg)} label="Kept out of landfill" />
        <Stat value={`${kg(s.co2SavedKg)}`} label="CO₂e avoided (estimate)" />
      </div>
      <div className="mt-8 flex flex-wrap gap-2">
        <Link to="/capture"><Button size="lg">Capture material</Button></Link>
        <Link to="/requests"><Button variant="secondary" size="lg">{pending ? `Answer ${pending} request${pending > 1 ? 's' : ''}` : 'View requests'}</Button></Link>
        <Link to="/listings" className="md:hidden"><Button variant="secondary" size="lg">Listings</Button></Link>
        <Link to="/impact" className="md:hidden"><Button variant="secondary" size="lg">Impact</Button></Link>
      </div>
    </>
  );
}

function DemandOverview({ s, role }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat value={s.counts.requests?.pending || 0} label="Requests waiting for a reply" />
        <Stat value={s.counts.requests?.accepted || 0} label="Accepted, ready to inspect" />
        <Stat value={kg(s.divertedKg)} label={role === 'Recycler' ? 'Material collected' : 'Material reclaimed'} />
        <Stat value={inr(s.spend)} label="Spent on reclaimed material" />
      </div>
      <div className="mt-8"><Link to="/marketplace"><Button size="lg">Search the marketplace</Button></Link></div>
    </>
  );
}

function AdminOverview({ s }) {
  return (
    <>
      <div className="grid grid-cols-2 gap-6 lg:grid-cols-4">
        <Stat value={s.counts.activeListings} label="Live listings" />
        <Stat value={kg(s.divertedKg)} label="Diverted platform-wide" />
        <Stat value={s.ttm.medianHours != null ? (s.ttm.medianHours < 1 ? '< 1 h' : `${s.ttm.medianHours} h`) : '-'} label="Median time-to-match" note="Target 48 h or less" />
        <Stat value={s.diversionRate != null ? `${s.diversionRate}%` : '-'} label="Diversion rate" note="Target 40% or more" />
      </div>
      <div className="mt-8"><Link to="/admin"><Button size="lg">Open moderation</Button></Link></div>
    </>
  );
}

const SUGGESTIONS = {
  Company: ['Show my inventory', 'How much CO₂ have we saved?', 'Any pending requests?'],
  Buyer: ['Steel under 30k near me', 'Bricks in good condition within 40 km', 'How does inspection work?'],
  Recycler: ['Glass near me', 'Concrete rubble within 50 km', 'Should I recycle cracked tiles?'],
  Admin: ['Platform impact summary', 'How is the price estimated?'],
};

export default function Overview() {
  const { user } = useAuth();
  const { data, error, loading } = useLoad(() => api('/analytics/summary'), []);
  const first = user.name.split(' ')[0];
  return (
    <>
      <PageHeader title={`Hello, ${first}`}>
        {user.role === 'Company' && `${user.organization || 'Your company'}${user.city ? ` in ${user.city}` : ''}.`}
        {(user.role === 'Buyer' || user.role === 'Recycler') && `Reclaimed material near ${user.city || 'you'}.`}
        {user.role === 'Admin' && 'Platform health at a glance.'}
      </PageHeader>
      {loading && <Spinner />}
      <ErrorNote>{error}</ErrorNote>
      {data && user.role === 'Company' && <CompanyOverview s={data} />}
      {data && (user.role === 'Buyer' || user.role === 'Recycler') && <DemandOverview s={data} role={user.role} />}
      {data && user.role === 'Admin' && <AdminOverview s={data} />}
      <section className="mt-10">
        <h2 className="mb-3 text-xl font-bold">Ask the assistant</h2>
        <Chat compact suggestions={SUGGESTIONS[user.role]} />
      </section>
    </>
  );
}
