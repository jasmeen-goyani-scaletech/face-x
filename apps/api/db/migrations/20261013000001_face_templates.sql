-- Up Migration

-- Face templates of the "node-native" face provider (face-api running inside this API). A face_profiles row still holds
-- only the provider's opaque reference; THIS table is the provider's own store, behind that reference, and is read and
-- written only by the node-native adapter. The 128-number descriptor is never stored in the clear: `descriptor` holds
-- 12-byte nonce || AES-256-GCM ciphertext (512 bytes) || 16-byte tag, encrypted under FACE_ENCRYPTION_KEY with the reference as
-- additional authenticated data (so a row cannot be moved to another reference). No image is kept here.
--
-- Deleting a face profile's template erases the biometric data for good (the face_profiles row stays as the record that an
-- enrollment existed). Nothing in the API returns this table.
create table public.face_templates (
  reference        uuid primary key default gen_random_uuid(),
  -- Our player id, as handed to the provider (no personal data). Not a foreign key: the provider knows nothing of our tables.
  subject_id       uuid not null,
  -- Which model produced the descriptor; descriptors of different models are not comparable.
  model            text not null check (char_length(btrim(model)) between 1 and 60),
  -- Which encryption key encrypted it, so the key can be rotated without losing faces.
  key_version      smallint not null default 1 check (key_version > 0),
  descriptor       bytea not null check (octet_length(descriptor) = 12 + 512 + 16),
  -- Stable per enrollment attempt: a retried enroll returns the same reference instead of creating a second template.
  idempotency_key  text not null check (char_length(idempotency_key) between 1 and 200),
  created_at       timestamptz not null default now(),
  constraint face_templates_idempotency_key_key unique (idempotency_key)
);

create index face_templates_subject_id_idx on public.face_templates (subject_id);
