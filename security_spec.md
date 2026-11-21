# Firestore Security Specification — Vansh Saxena Tender & Bid Management CRM

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every CRM document (`UserAccount`, `UserPreferences`, `FirmProfile`, `Tender`, `EmdBgRecord`, `MafTracker`, `AttachmentFile`) belongs to a single verified Google-authenticated user (`ownerUid == request.auth.uid`) stored exclusively in Firestore under `/users/{userId}/...` where `userId == request.auth.uid`.
2. **Master Gate Integrity**: Subcollection documents under `/users/{userId}/profile/*`, `/users/{userId}/settings/*`, `/users/{userId}/attachmentFiles/*`, `/users/{userId}/tenders/*`, `/users/{userId}/emdRecords/*`, and `/users/{userId}/maf_tracker/*` cannot be read (`get`), created, updated, or deleted unless the parent `/users/{userId}` document exists and its `ownerUid` equals `userId`.
3. **Verified Email Requirement**: Unverified accounts (`request.auth.token.email_verified != true`) are denied all read and write access.
4. **Bootstrapped Admin Privilege & Read-Only Legacy Recovery**: `vanshsaxena7498@gmail.com` (with `email_verified == true`) or UIDs present in `/admins/{uid}` act as system admin for state corrections; Bootstrapped Admin may also read/list sibling Admin UID subcollections, `/users/{userId}/emd_bg_tracker/*`, and legacy top-level collections (`tenders`, `emdRecords`, `emd_bg_tracker`, `maf_tracker`, `attachmentFiles`, `settings`, `profile`, `sheetConfig`, `emailConfig`, `emailAlerts`) read-only (`allow write: if false` on legacy collections). Non-admin users cannot escalate roles, write to `/admins/{uid}`, or read legacy collections.
5. **Temporal & Identity Immutability**: `ownerUid` and `createdAt` (`== request.time` on create) are strictly immutable on update; `updatedAt` must always equal `request.time`.
6. **Volumetric & Schema Guardrails**: All document IDs match `^[a-zA-Z0-9_\-]+$` (1..128 chars), every string has an explicit `.size()` bound (`AttachmentFile.dataUrl <= 950000`, `FirmProfile.adminPhotoUrl <= 150000`), every array is strictly bounded (`checklist <= 30`, `remarks <= 100`, `attachments <= 10`, `itemsMAF <= 50`), numeric amounts are `>= 0`, and no shadow/ghost fields are accepted (`hasAll` + `hasOnly` + `affectedKeys().hasOnly()`).
7. **Terminal State Locking**: Once a `Tender.stage` reaches `'L1 / Won'`, `'Lost (L2/L3)'`, `'Cancelled / Retendered'`, or `'Tender Not Filled'`, or an `EmdBgRecord.status` reaches `'Refunded / Released'` or `'Forfeited'`, non-admin updates are blocked unless overridden by `isAdmin()`.
8. **Query Enforcer**: All non-admin `allow list` rules explicitly enforce `resource.data.ownerUid == request.auth.uid` with zero `get()` or `exists()` calls (Admin list checks use email/claim-only `isBootstrappedAdmin()`).

---

## 2. The "Dirty Dozen" Adversarial Payloads (Expected: `PERMISSION_DENIED`)

1. **Unauthenticated Write (`UserAccount`)**:
   - Auth: `null`
   - Path: `/users/attackerUid`
   - Payload: `{ "ownerUid": "attackerUid", "email": "x@y.com", "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }`
2. **Unverified Email Spoof (`UserAccount`)**:
   - Auth: `{ uid: "u1", token: { email: "vanshsaxena7498@gmail.com", email_verified: false } }`
   - Path: `/users/u1`
   - Payload: `{ "ownerUid": "u1", "email": "vanshsaxena7498@gmail.com", "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }`
3. **Privilege Escalation (`AdminMarker`)**:
   - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
   - Path: `/admins/u2`
   - Payload: `{ "uid": "u2", "email": "user@example.com", "createdAt": "SERVER_TIME" }`
4. **Shadow / Ghost Field Injection (`Tender`)**:
   - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
   - Path: `/users/u2/tenders/t1`
   - Payload: Valid `Tender` fields + `"isApprovedAdmin": true`
5. **Cross-Tenant Identity Spoofing (`Tender`)**:
   - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
   - Path: `/users/u2/tenders/t2`
   - Payload: Valid `Tender` with `"ownerUid": "victimUid"`
6. **Orphaned Subcollection Write Without Parent Master Gate (`Tender`)**:
   - Auth: `{ uid: "u3", token: { email: "u3@example.com", email_verified: true } }`
   - Parent `/users/u3` does NOT exist
   - Path: `/users/u3/tenders/t3`
   - Payload: Valid `Tender`
7. **ID Poisoning / Path Traversal (`Tender`)**:
   - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
   - Path: `/users/u2/tenders/bad$id.with.dots`
   - Payload: Valid `Tender` with `"id": "bad$id.with.dots"`
8. **Client-Forged Timestamp (`EmdBgRecord`)**:
   - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
   - Path: `/users/u2/emdRecords/e1`
   - Payload: Valid `EmdBgRecord` with `"createdAt": "2020-01-01T00:00:00Z"` instead of `request.time`
9. **Denial-of-Wallet Oversized Photo (`FirmProfile`)**:
   - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
   - Path: `/users/u2/profile/firm`
   - Payload: Valid `FirmProfile` with `"adminPhotoUrl": "<200000 chars>"`
10. **Immutable Field Tampering on Update (`Tender`)**:
    - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
    - Path: `/users/u2/tenders/t1`
    - Update Payload: `{ "createdAt": "SERVER_TIME", "updatedAt": "SERVER_TIME" }` (mutating `createdAt`)
11. **Terminal State Mutation by Non-Admin (`EmdBgRecord`)**:
    - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
    - Existing doc status: `"Refunded / Released"`
    - Update Payload: `{ "status": "Active / Locked", "amount": 9999999, "updatedAt": "SERVER_TIME" }`
12. **Cross-Tenant PII Read / List Scraping (`UserAccount` / `FirmProfile`)**:
    - Auth: `{ uid: "u2", token: { email: "user@example.com", email_verified: true } }`
    - Operation: `get /users/victimUid` or `list /users/victimUid/tenders` without matching `ownerUid`

---

## 3. Verification Runner
See `firestore.rules.test.ts` for automated verification of all 12 Dirty Dozen adversarial payloads.
