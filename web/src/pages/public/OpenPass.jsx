// Opens a pass from a personal link: /p#<qrToken>. The token stays in the URL fragment so it never reaches server logs.
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, Spinner } from '../../components/ui.jsx';
import { api } from '../../lib/api.js';
import { passStore } from '../../lib/passStore.js';
import { PublicLayout } from './shared.jsx';

export default function OpenPass() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const ctrl = new AbortController();
    api('/pass/open', { method: 'POST', body: { qrToken: window.location.hash.slice(1) }, signal: ctrl.signal })
      .then((pass) => {
        // Never replace a pass this device already holds; navigation state shows this one.
        if (!passStore.get()) passStore.set(pass);
        navigate(`/pass/${pass.user.id}`, { replace: true, state: { pass } });
      })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message || 'Could not open this pass.'); });
    return () => ctrl.abort();
  }, [navigate]);

  return (
    <PublicLayout back="/">
      <Card className="p-8 text-center">
        {error ? (
          <>
            <p role="alert" className="font-semibold text-ink-900">{error}</p>
            <Button to="/find-pass" className="mt-5">Find my pass</Button>
          </>
        ) : <Spinner className="mx-auto" />}
      </Card>
    </PublicLayout>
  );
}
