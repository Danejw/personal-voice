-- Allow Remote Dictation as a cloud history destination.
-- Legacy rows may still say send-to-device; both remain valid.

alter table public.dictations
  drop constraint if exists dictations_destination_check;

alter table public.dictations
  add constraint dictations_destination_check
  check (destination = any (array[
    'active-field'::text,
    'voice-note'::text,
    'remote-dictation'::text,
    'send-to-device'::text
  ]));
