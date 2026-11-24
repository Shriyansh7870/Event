// Preview + send an attendee's QR pass on WhatsApp.
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Download, MessageCircle, Send, Share2, X } from 'lucide-react';
import { Button, Spinner } from '../../../components/ui.jsx';
import { loadQrcode, downloadBlob } from '../bulk/libs.js';
import { familyLabel } from '../../../lib/family.js';
import { renderTicketPng } from '../../public/ticketImage.js';

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1]);
  r.onerror = () => reject(r.error);
  r.readAsDataURL(blob);
});

function buildMessage(info) {
  const { user, eventName, guests, qrToken } = info;
  const link = `${info.appUrl || window.location.origin}/p#${qrToken}`;
  return [
    `Hello ${user.primaryName || user.fullName}, ${user.primaryName ? `${user.fullName}'s` : 'your'} entry pass for *${eventName}* is ready.`,
    '',
    `Pass code: ${user.code}`,
    familyLabel(user) || null,
    `Mobile: ${info.phone}`,
    user.email ? `Email: ${user.email}` : null,
    user.organization ? `Organization: ${user.organization}` : null,
    `Guests: ${guests}`,
    ...(user.adults || []).map((m) => `• ${m.name} (${m.relationship})`),
    ...(user.kids || []).map((m) => `• ${m.name} (child)`),
    '',
    info.family.length > 1 && !user.primaryName ? 'Each guest has their own QR pass, sent separately.' : null,
    'Please show the QR code at the entrance. Open the QR pass:',
    link,
  ].filter((l) => typeof l === 'string').join('\n');
}

export default function WhatsAppDialog({ user: initial, call, onSent, onClose }) {
  const [user, setUser] = useState(initial);
  const [family, setFamily] = useState([]);
  const ref = useRef(null);
  const [info, setInfo] = useState(null);
  const [png, setPng] = useState(null);
  const [preview, setPreview] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => { ref.current?.showModal(); }, []);

  useEffect(() => {
    let alive = true;
    let url = '';
    setPng(null); setError(''); setSent(false); setCopied(false);
    (async () => {
      try {
        const d = await call(`/admin/users/${user.id}/whatsapp`);
        const QR = await loadQrcode();
        const qrCanvas = document.createElement('canvas');
        await QR.toCanvas(qrCanvas, d.qrToken, { width: 720, margin: 0, errorCorrectionLevel: 'M' });
        const blob = await renderTicketPng({ qrCanvas, user: d.user, eventName: d.eventName });
        if (!alive) return;
        url = URL.createObjectURL(blob);
        setInfo(d);
        setFamily(d.family);
        setUser(d.user);
        setPng(blob);
        setPreview(url);
      } catch (e) {
        if (alive) setError(e.message || 'Could not prepare the pass.');
      }
    })();
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [call, user.id]);

  const message = info ? buildMessage(info) : '';
  const fileName = `${user.code}.png`;
  const file = png && new File([png], fileName, { type: 'image/png' });
  const canShare = !!file && !!navigator.canShare?.({ files: [file] });
  const localLink = info && !info.appUrl && /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(window.location.hostname);

  async function sendApi() {
    setBusy(true);
    setError('');
    try {
      const res = await call(`/admin/users/${user.id}/whatsapp`, { method: 'POST', body: { image: await toBase64(png) } });
      setSent(true);
      onSent(user.id, res.whatsappSentAt);
    } catch (e) {
      setError(e.message || 'Could not send.');
    } finally {
      setBusy(false);
    }
  }

  async function copyImage() {
    setError('');
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      setCopied(true);
    } catch {
      setError('This browser cannot copy images. Download it and attach it in the chat.');
    }
  }

  async function share() {
    try {
      await navigator.share({ files: [file], text: message });
    } catch (e) {
      if (e?.name !== 'AbortError') setError('Sharing is not available on this device.');
    }
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="wa-title"
      className="m-auto w-[min(44rem,calc(100vw-2rem))] max-h-[90dvh] overflow-y-auto rounded-2xl bg-white p-0 shadow-xl backdrop:bg-slate-900/50">
      <header className="flex items-center gap-3 border-b border-slate-100 px-5 py-4">
        <MessageCircle className="size-5 text-success-600 shrink-0" />
        <div className="min-w-0 flex-1">
          <h2 id="wa-title" className="font-bold text-ink-900 truncate">Send pass to {user.fullName}</h2>
          <p className="text-sm text-ink-500 tabular-nums">WhatsApp +{info?.to || user.phone}</p>
        </div>
        <button type="button" aria-label="Close" onClick={() => ref.current?.close()} className="grid place-items-center size-9 rounded-lg text-ink-500 hover:bg-slate-100"><X className="size-5" /></button>
      </header>

      <div className="p-5">
        {family.length > 1 && (
          <label className="mb-4 block text-sm font-medium text-ink-700">Pass to send
            <select value={user.id} disabled={busy || !png} onChange={(e) => setUser(family.find((m) => m.id === e.target.value))}
              className="mt-1.5 h-11 w-full rounded-xl bg-white px-3 text-ink-900 ring-1 ring-slate-200">
              {family.map((m) => <option key={m.id} value={m.id}>{m.fullName}</option>)}
            </select>
          </label>
        )}
        {error && <p role="alert" className="mb-4 rounded-xl bg-danger-50 p-3 text-sm text-danger-600">{error}</p>}
        {!png ? (!error && <div className="flex justify-center py-16"><Spinner /></div>) : (
          <div className="grid gap-5 sm:grid-cols-[13rem_1fr]">
            <img src={preview} alt={`QR pass for ${user.fullName}`} className="mx-auto w-full max-w-52 rounded-xl ring-1 ring-slate-200" />
            <div className="min-w-0 space-y-4">
              {info.mode === 'api' ? (
                <>
                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
                    {[['Name', info.user.fullName], ['Event', info.eventName], ['Pass code', info.user.code], ['Mobile', info.phone], ['Guests', info.guests]].map(([k, v]) => (
                      <div key={k} className="contents"><dt className="text-ink-500">{k}</dt><dd className="font-semibold text-ink-900 break-words">{v}</dd></div>
                    ))}
                  </dl>
                  {sent
                    ? <p role="status" className="flex items-center gap-2 rounded-xl bg-success-50 p-3 text-sm font-semibold text-success-600"><Check className="size-4" /> Accepted by WhatsApp</p>
                    : <Button variant="success" icon={Send} loading={busy} onClick={sendApi} className="w-full">Send QR and details</Button>}
                </>
              ) : (
                <>
                  <pre className="max-h-56 overflow-y-auto whitespace-pre-wrap [overflow-wrap:anywhere] rounded-xl bg-slate-50 p-3 font-sans text-sm text-ink-700">{message}</pre>
                  {localLink && <p className="rounded-xl bg-warn-50 p-3 text-xs text-ink-700">The pass link points to this local address and won’t open for the attendee. Send the QR image too, or set PUBLIC_APP_URL.</p>}
                  <div className="grid gap-2">
                    <Button variant="secondary" icon={copied ? Check : Copy} onClick={copyImage}>{copied ? 'QR image copied' : '1. Copy QR image'}</Button>
                    <a href={`https://wa.me/${info.to}?text=${encodeURIComponent(message)}`} target="_blank" rel="noopener noreferrer"
                      className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-success-600 px-4 text-sm font-semibold text-white hover:bg-success-500">
                      <MessageCircle className="size-4" /> 2. Open WhatsApp chat
                    </a>
                    <p className="text-xs text-ink-500">Paste the image into the chat, then press send.</p>
                  </div>
                </>
              )}
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="ghost" icon={Download} onClick={() => downloadBlob(png, fileName)}>Download</Button>
                {canShare && <Button size="sm" variant="ghost" icon={Share2} onClick={share}>Share image</Button>}
              </div>
            </div>
          </div>
        )}
      </div>
    </dialog>
  );
}
