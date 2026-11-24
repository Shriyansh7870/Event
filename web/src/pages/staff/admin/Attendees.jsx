// Admin "Attendees" tab: toolbar (search, status filter, export) + full-width table with pagination. Cards below md.
import { useEffect, useRef, useState } from 'react';
import { Ban, ChevronLeft, ChevronRight, Download, MessageCircle, RotateCcw, Search, Users } from 'lucide-react';
import { Avatar, Badge, Button, Input, cx } from '../../../components/ui.jsx';
import { EmptyState, Panel } from '../adminKit.jsx';
import { Skeleton, formatTime, useDebounced } from '../shared.jsx';
import { CopyButton, ErrorBlock, Segmented, fmt, formatDate, tableTd, tableTh } from './common.jsx';
import { familyLabel } from '../../../lib/family.js';
import CancelDialog from './CancelDialog.jsx';
import WhatsAppDialog from './WhatsAppDialog.jsx';

const REFRESH_MS = 5_000; // pick up gate scans without reloading the page
const PAGE_SIZE = 12; // the server returns one page at a time
// Column template shared by header, rows and skeleton.
const COLS = {
  attendee: '',
  code: 'w-[9rem]',
  mobile: 'hidden lg:table-cell w-[8rem]',
  guests: 'hidden xl:table-cell w-[5rem]',
  org: 'hidden 2xl:table-cell w-[12%]',
  source: 'hidden 2xl:table-cell w-[5rem]',
  registered: 'hidden xl:table-cell w-[7rem]',
  status: 'w-[8.5rem]',
  actions: 'w-[15rem] text-right',
};

export default function Attendees({ call, stats, onChanged, exportCsv, exporting, exportError }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const q = useDebounced(search.trim(), 300);
  // The page belongs to one search + filter; changing either goes back to page 1.
  const view = `${status}|${q}`;
  const [paging, setPaging] = useState({ view, page: 1 });
  const page = paging.view === view ? paging.page : 1;
  if (paging.view !== view) setPaging({ view, page: 1 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const topRef = useRef(null);
  const [waUser, setWaUser] = useState(null);
  const [cancelUser, setCancelUser] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    const params = new URLSearchParams({ search: q, status, page: String(page), limit: String(PAGE_SIZE) });
    call(`/admin/users?${params}`, { signal: ctrl.signal })
      .then((d) => { setData(d); setError(''); })
      .catch((e) => { if (e.name !== 'AbortError') setError(e.message || 'Could not load attendees.'); })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false); });
    return () => ctrl.abort();
  }, [call, q, status, page, reload]);

  // Quiet background refresh of the current page. Errors are ignored; the next tick retries.
  useEffect(() => {
    const ctrl = new AbortController();
    let running = false;
    const params = new URLSearchParams({ search: q, status, page: String(page), limit: String(PAGE_SIZE) });
    const t = setInterval(async () => {
      if (running || document.visibilityState !== 'visible') return;
      running = true;
      try {
        const d = await call(`/admin/users?${params}`, { signal: ctrl.signal });
        if (!ctrl.signal.aborted) { setData(d); setError(''); }
      } catch { /* retry on the next tick */ } finally { running = false; }
    }, REFRESH_MS);
    return () => { clearInterval(t); ctrl.abort(); };
  }, [call, q, status, page]);

  function markSent(id, whatsappSentAt) {
    setData((d) => d && { ...d, items: d.items.map((u) => (u.id === id ? { ...u, whatsappSentAt } : u)) });
  }

  function patchUser(user) {
    setData((d) => d && { ...d, items: d.items.map((u) => (u.id === user.id ? { ...u, ...user } : u)) });
    if (!user.primaryId && guestCount(user) > 1) setReload((r) => r + 1); // linked guests changed too
    onChanged();
  }

  function goPage(p) {
    setPaging({ view, page: p });
    topRef.current?.scrollIntoView({ block: 'nearest' });
  }

  const filters = [
    { id: 'all', label: 'All', count: stats?.totalUsers },
    { id: 'checked', label: 'Checked in', short: 'Arrived', count: stats?.checkedIn },
    { id: 'pending', label: 'Not arrived', short: 'Pending', count: stats?.pending },
  ];

  return (
    <div className="animate-fade-up" ref={topRef}>
      <Panel bodyClassName="p-0">
        {/* toolbar */}
        <div className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 sm:px-5 py-4 border-b border-slate-100">
          <div className="flex-1 min-w-0 lg:max-w-xl">
            <Input icon={Search} type="search" value={search} onChange={(e) => setSearch(e.target.value)} className="h-10"
              placeholder="Search name, code, email or phone" aria-label="Search attendees" />
          </div>
          <div className="flex items-center gap-3 lg:ml-auto min-w-0">
            <div className="overflow-x-auto [scrollbar-width:none] min-w-0 flex-1 sm:flex-none">
              <Segmented value={status} onChange={setStatus} options={filters} label="Filter by status" />
            </div>
            <span className="hidden sm:block shrink-0">
              <Button variant="secondary" size="sm" icon={Download} loading={exporting} onClick={exportCsv} className="h-10">Export CSV</Button>
            </span>
          </div>
        </div>
        {exportError && <p role="alert" className="px-5 py-2 text-sm text-danger-600 bg-danger-50 border-b border-danger-500/20">{exportError}</p>}

        <div aria-busy={loading}>
          {error ? (
            <ErrorBlock message={error} onRetry={() => setReload((r) => r + 1)} />
          ) : !data ? (
            <TableSkeleton rows={8} />
          ) : data.items.length === 0 ? (
            <EmptyState icon={q ? Search : Users} title={q ? 'No attendees found' : 'No one in this view yet'}>
              {q ? `Nothing matches “${q}”. Try a code, phone or email.` : 'Attendees appear here as soon as they register.'}
            </EmptyState>
          ) : (
            <div className={cx('transition-opacity', loading && 'opacity-60')}>
              {/* md+: table */}
              <table className="hidden md:table w-full table-fixed text-sm">
                <thead className="sticky top-[100px] lg:top-16 z-[5] bg-slate-50 shadow-[inset_0_-1px_0_rgb(241_245_249)]">
                  <tr>
                    <th className={cx(tableTh, COLS.attendee)}>Attendee</th>
                    <th className={cx(tableTh, COLS.code)}>Code</th>
                    <th className={cx(tableTh, COLS.mobile)}>Mobile</th>
                    <th className={cx(tableTh, COLS.guests)}>Guests</th>
                    <th className={cx(tableTh, COLS.org)}>Organization</th>
                    <th className={cx(tableTh, COLS.source)}>Source</th>
                    <th className={cx(tableTh, COLS.registered)}>Registered</th>
                    <th className={cx(tableTh, COLS.status)}>Status</th>
                    <th className={cx(tableTh, COLS.actions)}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {data.items.map((u) => <UserRow key={u.id} user={u} onWhatsApp={setWaUser} onCancel={setCancelUser} call={call} onPatched={patchUser} />)}
                </tbody>
              </table>
              {/* phones: cards */}
              <ul className="md:hidden divide-y divide-slate-100">
                {data.items.map((u) => <UserCard key={u.id} user={u} onWhatsApp={setWaUser} onCancel={setCancelUser} call={call} onPatched={patchUser} />)}
              </ul>
            </div>
          )}
        </div>

        {data && !error && data.total > 0 && (
          <Pagination page={data.page} pages={data.pages} total={data.total} loading={loading}
            onPage={goPage} />
        )}
      </Panel>
      {cancelUser && <CancelDialog user={cancelUser} call={call} onCancelled={patchUser} onClose={() => setCancelUser(null)} />}
      {waUser && <WhatsAppDialog user={waUser} call={call} onSent={markSent} onClose={() => setWaUser(null)} />}
    </div>
  );
}

function Pagination({ page, pages, total, loading, onPage }) {
  const from = (page - 1) * PAGE_SIZE + 1;
  const to = Math.min(page * PAGE_SIZE, total);
  return (
    <div className="flex flex-col sm:flex-row sm:items-center gap-3 px-4 sm:px-5 py-3 border-t border-slate-100 text-sm">
      <p className="text-ink-500 tabular-nums">
        Showing <span className="font-semibold text-ink-900">{fmt(from)}–{fmt(to)}</span> of <span className="font-semibold text-ink-900">{fmt(total)}</span>
      </p>
      <div className="sm:ml-auto flex flex-wrap items-center gap-3">
        {pages > 1 && (
          <nav className="flex items-center gap-1" aria-label="Pagination">
            <PageBtn disabled={page <= 1 || loading} onClick={() => onPage(page - 1)} label="Previous page"><ChevronLeft className="size-4" /></PageBtn>
            {pageList(page, pages).map((p, i) => p === '…'
              ? <span key={`e${i}`} className="w-8 text-center text-ink-400">…</span>
              : <PageBtn key={p} active={p === page} disabled={loading} onClick={() => onPage(p)} label={`Page ${p}`}>{fmt(p)}</PageBtn>)}
            <PageBtn disabled={page >= pages || loading} onClick={() => onPage(page + 1)} label="Next page"><ChevronRight className="size-4" /></PageBtn>
          </nav>
        )}
      </div>
    </div>
  );
}

function pageList(page, pages) {
  const set = new Set([1, pages, page, page - 1, page + 1]);
  if (page <= 3) [2, 3, 4].forEach((p) => set.add(p));
  if (page >= pages - 2) [pages - 1, pages - 2, pages - 3].forEach((p) => set.add(p));
  const list = [...set].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  const out = [];
  list.forEach((p, i) => {
    if (i && p - list[i - 1] > 1) out.push('…');
    out.push(p);
  });
  return out;
}

function PageBtn({ active, children, label, ...props }) {
  return (
    <button type="button" aria-label={label} aria-current={active ? 'page' : undefined} {...props}
      className={cx('min-w-9 h-9 px-2 rounded-lg text-sm font-semibold tabular-nums grid place-items-center transition disabled:opacity-40 disabled:pointer-events-none',
        active ? 'bg-brand-600 text-white shadow-sm' : 'text-ink-700 ring-1 ring-slate-200 bg-white hover:bg-slate-50')}>
      {children}
    </button>
  );
}

function TableSkeleton({ rows }) {
  return (
    <div>
      <div className="hidden md:block h-10 bg-slate-50 border-b border-slate-100" />
      <div className="divide-y divide-slate-100">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-5 h-[60px]">
            <Skeleton className="size-9 rounded-full shrink-0" />
            <div className="flex-1 space-y-1.5 min-w-0"><Skeleton className="h-3.5 w-40 max-w-full" /><Skeleton className="h-3 w-52 max-w-full" /></div>
            <Skeleton className="hidden md:block h-3.5 w-24" />
            <Skeleton className="hidden xl:block h-3.5 w-20" />
            <Skeleton className="hidden 2xl:block h-3.5 w-28" />
            <Skeleton className="hidden md:block h-5 w-14 rounded-full" />
            <Skeleton className="hidden md:block h-5 w-20 rounded-full" />
            <Skeleton className="h-8 w-24 rounded-lg" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Cancel opens the reason dialog; reactivate uses a two-tap confirm. */
function useToggleStatus(user, call, onPatched, onCancel) {
  const [armed, setArmed] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const timer = useRef(null);
  const cancelled = user.status === 'cancelled';
  useEffect(() => () => clearTimeout(timer.current), []);

  async function toggle() {
    if (!cancelled) { onCancel(user); return; }
    if (!armed) {
      setArmed(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setArmed(false), 3500);
      return;
    }
    clearTimeout(timer.current);
    setSaving(true);
    setErr('');
    try {
      const res = await call(`/admin/users/${user.id}`, { method: 'PATCH', body: { status: 'active' } });
      onPatched(res.user);
    } catch (e) {
      setErr(e.message || 'Update failed');
    } finally {
      setSaving(false);
      setArmed(false);
    }
  }
  return { armed, saving, err, cancelled, toggle };
}

function ActionButton({ t, className }) {
  return (
    <Button size="sm" variant={t.armed ? 'primary' : 'secondary'} loading={t.saving} onClick={t.toggle}
      icon={t.cancelled ? RotateCcw : Ban} className={cx('h-8 px-2.5 text-[13px] whitespace-nowrap', className)}>
      {t.armed ? 'Tap to confirm' : t.cancelled ? 'Reactivate' : 'Cancel pass'}
    </Button>
  );
}

function WhatsAppButton({ user, onClick }) {
  const sent = user.whatsappSentAt;
  return (
    <Button size="sm" variant={sent ? 'secondary' : 'success'} icon={MessageCircle} disabled={user.status === 'cancelled'}
      onClick={() => onClick(user)} className="h-8 px-2.5 text-[13px] whitespace-nowrap"
      aria-label={`Send pass to ${user.fullName} on WhatsApp`} title={sent ? `Sent ${formatTime(sent)}` : 'Send QR pass on WhatsApp'}>
      {sent ? 'Resend' : 'Send'}
    </Button>
  );
}

const guestCount = (u) => 1 + (u.adults?.length || 0) + (u.kids?.length || 0);
const guestNames = (u) => [...(u.adults || []).map((m) => `${m.name} (${m.relationship})`), ...(u.kids || []).map((m) => `${m.name} (child)`)].join(', ');

function StatusBadge({ user }) {
  if (user.status === 'cancelled') {
    return (
      <div className="min-w-0">
        <Badge tone="danger">Cancelled</Badge>
        {user.cancelReason && (
          <p className="mt-0.5 text-xs text-ink-500 line-clamp-2 break-words" title={`${user.cancelReason} (${user.cancelledBy}, ${formatTime(user.cancelledAt)})`}>{user.cancelReason}</p>
        )}
      </div>
    );
  }
  if (user.checkedIn) {
    return (
      <div className="min-w-0">
        <Badge tone="success">Checked in</Badge>
        <p className="mt-0.5 text-xs text-ink-500 tabular-nums truncate">at {formatTime(user.checkedInAt)}</p>
      </div>
    );
  }
  return <Badge tone="neutral">Not arrived</Badge>;
}

function SourceBadge({ user }) {
  return user.source === 'bulk'
    ? <span title={user.batchId ? `Bulk upload · ${user.batchId}` : 'Bulk upload'}><Badge tone="brand">Bulk</Badge></span>
    : <span title="Self-registered"><Badge>Self</Badge></span>;
}

function UserRow({ user, onWhatsApp, onCancel, call, onPatched }) {
  const t = useToggleStatus(user, call, onPatched, onCancel);
  return (
    <tr className="group even:bg-slate-50/40 hover:bg-brand-50/40 transition-colors">
      <td className={tableTd}>
        <div className="flex items-center gap-3 min-w-0">
          <Avatar src={user.photo} name={user.fullName} size="size-9 shrink-0 text-xs" />
          <div className="min-w-0">
            <p className={cx('font-semibold truncate', t.cancelled ? 'line-through text-ink-400' : 'text-ink-900')} title={user.fullName}>{user.fullName}</p>
            <p className="text-xs text-ink-500 truncate" title={familyLabel(user) || user.email}>{familyLabel(user) || user.email}<span className="lg:hidden">{user.phone ? `${user.email ? ' · ' : ''}${user.phone}` : ''}</span></p>
          </div>
        </div>
      </td>
      <td className={tableTd}>
        <div className="flex items-center gap-1">
          <span className="font-mono text-xs text-ink-700 truncate" title={user.code}>{user.code}</span>
          <span className="opacity-60 group-hover:opacity-100 focus-within:opacity-100"><CopyButton value={user.code} label="Copy code" /></span>
        </div>
      </td>
      <td className={cx(tableTd, 'hidden lg:table-cell tabular-nums text-ink-700')}><span className="block truncate" title={user.phone}>{user.phone || '—'}</span></td>
      <td className={cx(tableTd, 'hidden xl:table-cell tabular-nums text-ink-700')} title={guestNames(user) || undefined}>{user.primaryId ? '—' : guestCount(user)}</td>
      <td className={cx(tableTd, COLS.org.replace(/w-\S+/, ''))}><span className="block truncate text-ink-700" title={user.organization}>{user.organization || <span className="text-ink-400">—</span>}</span></td>
      <td className={cx(tableTd, 'hidden 2xl:table-cell')}><SourceBadge user={user} /></td>
      <td className={cx(tableTd, 'hidden xl:table-cell text-ink-600 tabular-nums whitespace-nowrap')} title={formatTime(user.createdAt)}>{formatDate(user.createdAt)}</td>
      <td className={tableTd}><StatusBadge user={user} /></td>
      <td className={cx(tableTd, 'text-right')}>
        <div className="flex justify-end gap-2"><WhatsAppButton user={user} onClick={onWhatsApp} /><ActionButton t={t} /></div>
        {t.err && <p className="text-xs text-danger-600 mt-1 truncate" title={t.err}>{t.err}</p>}
      </td>
    </tr>
  );
}

function UserCard({ user, onWhatsApp, onCancel, call, onPatched }) {
  const t = useToggleStatus(user, call, onPatched, onCancel);
  return (
    <li className="px-4 py-3.5">
      <div className="flex items-start gap-3">
        <Avatar src={user.photo} name={user.fullName} size="size-10 shrink-0 text-sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <p className={cx('font-semibold truncate flex-1', t.cancelled ? 'line-through text-ink-400' : 'text-ink-900')} title={user.fullName}>{user.fullName}</p>
            <SourceBadge user={user} />
          </div>
          <p className="text-xs text-ink-500 truncate">{familyLabel(user) || user.email}</p>
          <div className="mt-1 flex items-center gap-1 text-xs text-ink-600">
            <span className="font-mono">{user.code}</span><CopyButton value={user.code} label="Copy code" />
            <span className="text-ink-300">·</span><span className="tabular-nums truncate">{user.phone}</span>
          </div>
        </div>
      </div>
      <div className="mt-2.5 pl-13 flex items-center gap-2">
        <div className="flex-1 min-w-0"><StatusBadge user={user} /></div>
        <WhatsAppButton user={user} onClick={onWhatsApp} />
        <ActionButton t={t} />
      </div>
      {t.err && <p className="pl-13 text-xs text-danger-600 mt-1">{t.err}</p>}
    </li>
  );
}
