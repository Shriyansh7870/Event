// WhatsApp Cloud API (Meta) client: uploads the pass image, then sends an approved template with it.
import { config } from '../config.js';
import { HttpError } from './errors.js';

const wa = config.whatsapp;
export const whatsappConfigured = () => !!(wa.token && wa.phoneNumberId && wa.template);

/** International digits only (no +). 10-digit local numbers get the default country code. */
export function toWhatsappNumber(phone) {
  let d = String(phone || '').replace(/\D/g, '').replace(/^00/, '');
  if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  if (d.length === 10) d = wa.countryCode + d;
  return d;
}

export function guestSummary(u) {
  if (u.primaryId) return `1 (guest of ${u.primaryName})`;
  const adults = u.adults?.length || 0;
  const kids = u.kids?.length || 0;
  return `${1 + adults + kids} (${1 + adults} adult${adults ? 's' : ''}, ${kids} ${kids === 1 ? 'child' : 'children'})`;
}

async function graph(path, init) {
  let res;
  try {
    res = await fetch(`https://graph.facebook.com/${wa.apiVersion}/${wa.phoneNumberId}/${path}`, {
      ...init,
      headers: { ...init.headers, Authorization: `Bearer ${wa.token}` },
      signal: AbortSignal.timeout(8_000), // two calls must fit in a serverless function's time limit
    });
  } catch {
    throw new HttpError(502, 'Could not confirm with WhatsApp. Check the chat before sending again.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('[whatsapp]', res.status, data?.error?.code, data?.error?.message);
    throw new HttpError(502, `WhatsApp: ${data?.error?.error_data?.details || data?.error?.message || `request failed (${res.status})`}`);
  }
  return data;
}

/** @returns {Promise<string>} message id. Accepted by WhatsApp; delivery is asynchronous. */
export async function sendPassTemplate(user, phone, png) {
  const form = new FormData();
  form.append('messaging_product', 'whatsapp');
  form.append('type', 'image/png');
  form.append('file', new Blob([png], { type: 'image/png' }), `${user.code}.png`);
  const media = await graph('media', { method: 'POST', body: form });

  const text = (v) => ({ type: 'text', text: String(v || '-').replace(/\s+/g, ' ') });
  const data = await graph('messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      to: toWhatsappNumber(phone),
      type: 'template',
      template: {
        name: wa.template,
        language: { code: wa.templateLang },
        components: [
          { type: 'header', parameters: [{ type: 'image', image: { id: media.id } }] },
          // Order must match the approved template: name, event, pass code, mobile, guests.
          { type: 'body', parameters: [user.fullName, config.eventName, user.code, phone, guestSummary(user)].map(text) },
        ],
      },
    }),
  });
  return data.messages?.[0]?.id || '';
}
