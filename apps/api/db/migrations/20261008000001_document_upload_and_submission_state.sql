-- Up Migration

-- A document goes through steps that the review status (PENDING / APPROVED / REJECTED) cannot express:
--   1. upload requested  (row exists, uploaded_at is null: a signed upload URL was issued)
--   2. uploaded          (uploaded_at set after the server verified the stored object)
--   3. submitted         (submitted_at set: the family sent it for review)
--   4. reviewed          (status APPROVED or REJECTED, recorded in document_reviews)
-- The review status stays exactly as it was and is never mixed with these steps.
alter table public.documents
  add column uploaded_at  timestamptz,
  add column submitted_at timestamptz;

-- Rows can only pre-date this migration if they were inserted by hand (there was no document API before):
-- treat them as uploaded, and as submitted if they were already reviewed.
update public.documents set uploaded_at = created_at where uploaded_at is null;
update public.documents set submitted_at = created_at where status <> 'PENDING' and submitted_at is null;

-- Cannot submit what was never uploaded, and cannot review what was never submitted.
alter table public.documents
  add constraint documents_submission_requires_upload_check
    check (submitted_at is null or uploaded_at is not null),
  add constraint documents_review_requires_submission_check
    check (status = 'PENDING' or submitted_at is not null);

-- A document belongs to one registration and one type for good. A different type or registration is a
-- different document (replacing a file re-keys the same row; it never moves it).
create function public.documents_lock_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.registration_id is distinct from old.registration_id
     or new.document_type is distinct from old.document_type then
    raise exception 'a document cannot be moved to another registration or type'
      using errcode = 'restrict_violation';
  end if;
  return new;
end;
$$;

create trigger documents_lock_identity before update on public.documents
  for each row execute function public.documents_lock_identity();

-- Review queue for admins: submitted documents waiting for a decision.
create index documents_awaiting_review_idx on public.documents (submitted_at)
  where status = 'PENDING' and submitted_at is not null;
