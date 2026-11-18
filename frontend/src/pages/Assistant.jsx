import { useAuth } from '../auth';
import Chat from '../components/Chat';
import { PageHeader, useLoad } from '../components/ui';
import { api } from '../api';

const SUGGESTIONS = {
  Company: ['Show my steel inventory', 'How much is 500 kg of steel in good condition worth?', 'Should I recycle 300 kg of cracked tiles?', 'How much CO₂ have we saved?', 'Any pending requests?'],
  Buyer: ['Steel under 30k near me', 'Cheapest bricks within 40 km', 'Timber in excellent condition', 'What can you do?'],
  Recycler: ['Glass near me', 'Concrete rubble within 50 km', 'Should I recycle old glass?', 'What can you do?'],
  Admin: ['Platform impact summary', 'How is the price estimated?', 'What are the roles?'],
};

export default function Assistant() {
  const { user } = useAuth();
  const { data } = useLoad(() => api('/ai/status'), []);
  return (
    <>
      <PageHeader title="Assistant">
        Questions about your own data are answered from the database. Everything else comes from the built-in guide
        {data?.gemini?.configured ? ' or Gemini' : ''}. The assistant only reads; you confirm every change on its page.
      </PageHeader>
      <Chat suggestions={SUGGESTIONS[user.role]} />
      {data && (
        <p className="mt-3 text-xs text-graphite-400">
          AI service {data.aiService.reachable ? 'online' : 'offline (using built-in rules)'}.
          {' '}Gemini {data.gemini.configured ? `on (${data.gemini.model})` : 'not configured'}.
        </p>
      )}
    </>
  );
}
