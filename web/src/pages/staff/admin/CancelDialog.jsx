// Asks for a reason before cancelling an attendee's pass.
import { useEffect, useRef, useState } from 'react';
import { Ban } from 'lucide-react';
import { Button } from '../../../components/ui.jsx';

const MAX = 300;

export default function CancelDialog({ user, call, onCancelled, onClose }) {
  const ref = useRef(null);
  const [reason, setReason] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const clean = reason.trim();

  useEffect(() => { ref.current?.showModal(); }, []);

  async function submit(e) {
    e.preventDefault();
    if (clean.length < 3 || saving) return;
    setSaving(true);
    setError('');
    try {
      const res = await call(`/admin/users/${user.id}`, { method: 'PATCH', body: { status: 'cancelled', reason: clean } });
      onCancelled(res.user);
      ref.current?.close();
    } catch (err) {
      setError(err.message || 'Could not cancel this pass.');
      setSaving(false);
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} onCancel={(e) => { if (saving) e.preventDefault(); }} aria-labelledby="cancel-title"
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/50">
      <form onSubmit={submit} className="p-5">
        <div className="flex items-start gap-3">
          <span className="grid place-items-center size-10 rounded-xl bg-danger-50 text-danger-600 shrink-0"><Ban className="size-5" /></span>
          <div className="min-w-0">
            <h2 id="cancel-title" className="font-bold text-ink-900">Cancel this pass?</h2>
            <p className="text-sm text-ink-500 break-words">{user.fullName} · <span className="font-mono">{user.code}</span></p>
          </div>
        </div>
        {!user.primaryId && (user.adults?.length || 0) + (user.kids?.length || 0) > 0 && (
          <p className="mt-4 rounded-xl bg-warn-50 p-3 text-sm text-ink-700">This also cancels the linked passes of their {(user.adults?.length || 0) + (user.kids?.length || 0)} guest(s).</p>
        )}
        <label htmlFor="cancel-reason" className="mt-5 mb-1.5 block text-sm font-medium text-ink-700">Reason for cancelling</label>
        <textarea id="cancel-reason" autoFocus required minLength={3} maxLength={MAX} rows={4} value={reason} disabled={saving}
          onChange={(e) => setReason(e.target.value)} placeholder="For example: duplicate registration"
          className="w-full resize-none rounded-xl bg-white p-3.5 text-ink-900 placeholder:text-ink-400 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-brand-500" />
        <p className="mt-1 text-right text-xs text-ink-500 tabular-nums">{reason.length}/{MAX}</p>
        {error && <p role="alert" className="mt-2 rounded-xl bg-danger-50 p-3 text-sm text-danger-600">{error}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <Button type="button" variant="secondary" disabled={saving} onClick={() => ref.current?.close()}>Keep pass</Button>
          <Button type="submit" variant="danger" loading={saving} disabled={saving || clean.length < 3}>Cancel pass</Button>
        </div>
      </form>
    </dialog>
  );
}
