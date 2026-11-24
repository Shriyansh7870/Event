# Gate scanner app: API integration guide

How to connect a mobile scanner app to the QR Pass backend. The app scans attendee passes at several gates, works offline, and
sends check-ins to the server so the admin dashboard updates.

## 1. Quick start

1. Log in: `POST /api/staff/login`. Store the token.
2. Download users, check-ins and the public key: `GET /api/sync/snapshot?photos=1`. Save them on the device.
3. Scan a QR. Verify it on the device with the public key and find the user in the saved list.
4. Show the result. When staff tap **Confirm entry**, save a check-in locally as `pending`.
5. Upload pending check-ins: `POST /api/sync/checkins`. Then refresh the snapshot.

A scan alone changes nothing on the server. The status becomes *Checked in* after step 5.

## 2. Server address

| Where the app runs | Base URL |
|---|---|
| Production | `https://<your-site>/api` |
| iOS simulator, same computer | `http://localhost:<port>/api` |
| Android emulator, same computer | `http://10.0.2.2:<port>/api` |
| Physical phone, same Wi-Fi | `http://<computer-LAN-IP>:<port>/api` |

The default port is 4000; check which port your backend was started with. Android and iOS block plain `http://` by default,
so allow it in development builds only. Use HTTPS in production.

Send and receive JSON (`Content-Type: application/json`). Check the connection with `GET /api/health` → `{ "ok": true, "time": "..." }`.

## 3. Endpoints

| Method | Path | Login needed | Purpose |
|---|---|---|---|
| GET | `/api/health` | No | Is the server reachable? |
| GET | `/api/public-key` | No | Public key and event name |
| POST | `/api/staff/login` | No | Get a token |
| GET | `/api/sync/snapshot?photos=1` | Staff | All users and first check-ins |
| POST | `/api/sync/checkins` | Staff | Upload scans |
| GET | `/api/admin/users` | Admin | Paged user list |
| GET | `/api/admin/stats` | Admin | Totals and gate devices |
| GET | `/api/admin/duplicates` | Admin | Passes used more than once |

Staff means either role, `verifier` or `admin`. Gate devices should use `verifier` accounts. For "Staff" and "Admin" endpoints send:

```
Authorization: Bearer <token>
```

### 3.1 Login

`POST /api/staff/login`

```json
{ "username": "gate1", "password": "<password>" }
```

Response `200`:

```json
{ "token": "eyJhbGciOi...", "staff": { "username": "gate1", "name": "Gate 1", "role": "verifier" } }
```

- The token lasts 24 hours and there is no refresh endpoint. Log in again when it expires.
- Keep it in secure storage (Keychain or Keystore). Do not store the password.
- Login is limited to 20 requests per 15 minutes per IP address, so do not retry in a loop.
- An admin creates gate accounts in **Admin → Staff**.

### 3.2 Download users (snapshot)

`GET /api/sync/snapshot?photos=1`

Response `200` (shortened):

```json
{
  "serverTime": 1795541243438,
  "eventName": "Namma Honda Habba",
  "publicKey": {
    "kid": "rloTVvmW",
    "jwk": { "kty": "EC", "crv": "P-256", "x": "...", "y": "...", "kid": "rloTVvmW", "alg": "ES256", "use": "sig" }
  },
  "users": [
    {
      "id": "6b05c8fbd04210a9b7cbd256",
      "code": "TFX-ZF8X6T",
      "fullName": "Aarav Sharma",
      "phone": "9000000001",
      "primaryId": null,
      "primaryName": null,
      "relation": null,
      "email": "",
      "adults": [{ "name": "Asha Sharma", "relationship": "wife" }],
      "kids": [{ "name": "Dev Sharma" }],
      "organization": "",
      "photo": null,
      "status": "active",
      "source": "self",
      "batchId": null,
      "createdAt": "2026-11-24T17:27:23.058Z",
      "checkedIn": false,
      "checkedInAt": null
    },
    {
      "id": "6b05c8fbd04210a9b7cbd300",
      "code": "TFX-K4M8QP",
      "fullName": "Dev Sharma",
      "phone": "",
      "primaryId": "6b05c8fbd04210a9b7cbd256",
      "primaryName": "Aarav Sharma",
      "relation": "child",
      "email": "",
      "adults": [],
      "kids": [],
      "organization": "",
      "photo": null,
      "status": "active",
      "source": "self",
      "batchId": null,
      "createdAt": "2026-11-24T17:27:23.061Z",
      "checkedIn": false,
      "checkedInAt": null
    }
  ],
  "checkins": [
    {
      "id": "0f8c1b1e-6a0e-4a3e-9d0e-1d2f3a4b5c6d",
      "userId": "6b05c8fbd04210a9b7cbd257",
      "deviceId": "dev-1",
      "deviceName": "Gate 1",
      "verifiedBy": "gate1",
      "scannedAt": 1795540000000,
      "syncedAt": 1795541243441,
      "duplicate": false
    }
  ]
}
```

- The whole list comes in one response; there is no paging. Replace the saved users with it in one local database transaction.
- `checkins` holds the first check-in of each user from **all** gates.
- `photo` is `null` or a `data:image/...;base64,...` string. Photos stop after about 4 MB in total; show initials for the rest.
- Without `photos=1` the response is much smaller. Use it for frequent refreshes and keep the photos already saved. Download photos about every 10 minutes.
- Time formats differ: check-in times are epoch milliseconds, while `createdAt` and `checkedInAt` are ISO strings.
- Never delete local `pending` check-ins when importing a snapshot.

### 3.3 Upload check-ins

`POST /api/sync/checkins`

```json
{
  "deviceId": "b1f0c7de-0c43-4a6e-8f0b-2f6f3c1a9e11",
  "deviceName": "Gate 1",
  "checkins": [
    {
      "id": "0f8c1b1e-6a0e-4a3e-9d0e-1d2f3a4b5c6d",
      "userId": "6b05c8fbd04210a9b7cbd256",
      "scannedAt": 1795540000000,
      "verifiedBy": "gate1"
    }
  ]
}
```

| Field | Rule |
|---|---|
| `deviceId` | Required, up to 100 characters. Create a UUID once per install and keep it. |
| `deviceName` | Gate name, up to 60 characters |
| `checkins` | At most 200 per request; send more in batches |
| `checkins[].id` | New UUID for each confirmed scan. **Reuse the same one when retrying.** |
| `checkins[].userId` | The user's `id` (the `sub` value in the QR) |
| `checkins[].scannedAt` | When staff confirmed, in epoch milliseconds |
| `checkins[].verifiedBy` | Staff username; defaults to the logged-in user |

Response `200` when the person was already checked in elsewhere:

```json
{
  "accepted": ["a2"],
  "duplicates": [
    {
      "id": "a2",
      "userId": "6b05c8fbd04210a9b7cbd256",
      "firstCheckin": {
        "id": "a1", "userId": "6b05c8fbd04210a9b7cbd256", "deviceId": "dev-1", "deviceName": "Gate 1",
        "verifiedBy": "gate1", "scannedAt": 1795540000000, "syncedAt": 1795541243441, "duplicate": false
      }
    }
  ],
  "rejected": [],
  "serverTime": 1795541243450
}
```

**Check `duplicates` first.** A duplicate is stored, so its id is also in `accepted`.

| Id is in | Set the local status to |
|---|---|
| `duplicates` | `duplicate`; show which gate was first |
| `accepted` only | `synced` |
| `rejected` | Keep it and show the `reason`: `unknown user`, `invalid scannedAt` or `invalid id` |

- A `200` does not mean every scan was accepted. Always read the three lists.
- Resending the same `id` is safe and does not create another check-in.
- The server accepts a check-in for a cancelled pass. The app must block those itself.

### 3.4 Errors

```json
{ "error": "deviceId is required", "field": "deviceId" }
```

`field` is optional.

| Status | Meaning | App should |
|---|---|---|
| 400 | Invalid request | Show the error; fix it before retrying |
| 401 | Login failed, or token missing or expired | Ask staff to log in; **keep pending scans** |
| 403 | Account is not an admin | Use a permitted endpoint |
| 413 | Request too large | Send fewer check-ins |
| 429 | Too many requests | Wait, then retry |
| 500 or higher, or no network | Server or connection problem | Keep scans pending and retry later |

## 4. Verify the QR on the device

The QR text is a JWT signed with **ES256** (ECDSA P-256 with SHA-256).

- Header: `{ "alg": "ES256", "kid": "rloTVvmW" }`
- Payload: `{ "sub": "<userId>", "code": "TFX-ZF8X6T", "name": "Aarav Sharma", "iat": 1795541243 }`
- There is no expiry.

Check in this order:

1. The text has three parts separated by dots.
2. `alg` is exactly `ES256`. Reject anything else, including `none`.
3. `kid` matches `publicKey.kid`. If not, refresh the snapshot and try again.
4. The signature is valid for `publicKey.jwk`.
5. `sub` and `code` are present.

Use a maintained JWT library. Decoding the payload alone is **not** verification, because anyone can write a fake one.

### What to show

Apply the first row that matches:

| Condition | Result | Allow entry? |
|---|---|---|
| Verification failed | Red: invalid pass | No |
| User `status` is `cancelled` | Red: cancelled | No |
| A check-in exists for the user (local or from the snapshot), or `checkedIn` is true | Amber: already checked in; show time and gate | Only if staff allow re-entry |
| User is in the saved list | Green: valid | Yes, after **Confirm entry** |
| Valid signature, user not in the saved list | Green with a note: not in downloaded list | Yes, after **Confirm entry** |

### Families

Every guest is a separate user with their own `code`, QR and check-in. The QR's `sub` is that person's own `id`, so scanning and
uploading work the same for everyone.

- `primaryId` is `null` on the main registrant. On a guest it is the main registrant's `id`.
- `relation` is `child` for kids, or `wife`, `husband`, `mother`, `father`, `uncle`, `aunt`, `brother`, `sister`, `grandparent` or `other`.
- `adults` and `kids` on the main registrant are only names. **Do not check people in from those lists.**
- To find a family, set `rootId = user.primaryId ?? user.id`, then take the user whose `id` is `rootId` and every user whose `primaryId` is `rootId`.
- Show the family after a scan, with each person's status. To let staff check in several people together, save **one check-in per person**, each with a new `id` and that person's `userId`.
- Scanning the main registrant checks in **only** that person.
- If a family is in the list but someone has no linked user, that family entered before this feature existed.

**Manual code entry:** convert to upper case, remove spaces and find the user by `code`. Staff should check photo ID, because a typed code has no signature.

Ignore the same QR for 3 seconds, and pause scanning while a result is open.

## 5. Local database

| Table | Fields |
|---|---|
| `users` | All user fields; key `id`, indexes `code` and `primaryId` |
| `checkins` | `id`, `userId`, `scannedAt`, `verifiedBy`, `deviceId`, `deviceName`, `source` (`local`/`remote`), `status` (`pending`/`synced`/`duplicate`), `error` |
| `meta` | `deviceId`, `deviceName`, `publicKey`, `eventName`, `lastSnapshotAt`, `lastSyncAt` |

Index `checkins` by `userId` and `status`.

## 6. Sync

Run a sync after each confirmed entry, when the internet returns, when the app opens, every 60 seconds while online, and from a **Sync** button.

```text
function sync():
    if already syncing: run once more when it finishes, then return
    for each batch of 200 pending check-ins, oldest first:
        response = POST /api/sync/checkins
        for each check-in in the batch:
            if id in response.duplicates:     status = duplicate
            else if id in response.accepted:  status = synced
            else:                             keep pending, save the reason
    snapshot = GET /api/sync/snapshot
    replace users and remote check-ins; keep local check-ins

function confirmEntry(user):
    save check-in { id: newUUID(), userId, scannedAt: now, status: pending }
    sync()        // in the background; do not make staff wait
```

Running once more matters: a scan confirmed during a sync may have missed that upload.
Upload first, then download. If uploading fails, stop and leave everything pending.

## 7. Several gates

Give every device its own `deviceId` (automatic), a clear `deviceName` and its own verifier account. All devices must use the same server.

| Situation | Result |
|---|---|
| Gate 1 checks someone in, Gate 2 has synced since | Gate 2 shows amber |
| Gate 2 has not synced yet | Gate 2 shows green and can admit the same pass |
| Both gates offline | Both can admit the pass |
| After both upload | Earliest `scannedAt` is the real check-in; the other is a duplicate |

- A live "is this pass already used?" endpoint does not exist yet. Frequent syncing shortens the gap but does not close it.
- An earlier scan that uploads late replaces the first check-in, so always trust the latest snapshot.
- Order depends on device clocks. Keep automatic date and time on, and warn staff when the clock differs greatly from `serverTime`.

## 8. Example (JavaScript / React Native)

Signature checking and local storage depend on your framework, so they are not included here.

```js
const BASE = 'https://<your-site>/api';

async function request(path, { token, body } = {}) {
  const res = await fetch(BASE + path, {
    method: body ? 'POST' : 'GET',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  if (!res.ok || data === null) {
    const err = new Error(data?.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const login = (username, password) => request('/staff/login', { body: { username, password } });

export const getSnapshot = (token, photos = false) =>
  request(`/sync/snapshot${photos ? '?photos=1' : ''}`, { token });

export const sendCheckins = (token, deviceId, deviceName, checkins) =>
  request('/sync/checkins', { token, body: { deviceId, deviceName, checkins } });

/** New local status for each check-in in an uploaded batch. */
export function resolveBatch(batch, response) {
  const duplicates = new Map(response.duplicates.map((d) => [d.id, d]));
  const accepted = new Set(response.accepted);
  const rejected = new Map(response.rejected.map((r) => [r.id, r.reason]));
  return batch.map((c) => {
    if (duplicates.has(c.id)) return { ...c, status: 'duplicate', firstCheckin: duplicates.get(c.id).firstCheckin };
    if (accepted.has(c.id)) return { ...c, status: 'synced', error: null };
    return { ...c, status: 'pending', error: rejected.get(c.id) || 'Not accepted' };
  });
}
```

## 9. Test checklist

- [ ] Login works; a wrong password shows an error
- [ ] The snapshot downloads and the user count is correct
- [ ] A valid pass shows green, and the dashboard shows *Checked in* after confirming
- [ ] The same pass again shows amber with time and gate
- [ ] A child's QR checks in only the child; parent and siblings stay *Not arrived*
- [ ] Checking in a family together sends one check-in per person
- [ ] A cancelled pass shows red after a sync
- [ ] A changed or unrelated QR shows red
- [ ] Offline scans stay pending after closing and reopening the app, then upload
- [ ] Uploading the same check-in twice creates one record
- [ ] Two offline gates admit one pass: one duplicate appears after both sync
- [ ] An expired token asks for login without losing pending scans
- [ ] Staff cannot sign out unnoticed while scans are pending

## 10. Security

- The snapshot contains personal data, including children's names. Encrypt the local database and clear it after the event.
- Do not log tokens or QR text. A copied QR works as the pass.
- Use separate verifier accounts, not a shared admin login.
