-- Generalize explicitly saved voice notes into editable notes without losing old-client compatibility.

begin;

alter table public.voice_notes rename to notes;

alter table public.notes
  add column source_type text not null default 'voice'
  check (source_type in ('voice', 'manual', 'assistant'));

alter index public.voice_notes_user_status_created_idx
  rename to notes_user_status_created_idx;

alter trigger voice_notes_touch_updated_at on public.notes
  rename to notes_touch_updated_at;

alter policy "Users manage their own voice notes" on public.notes
  rename to "Users manage their own notes";

comment on table public.notes is
  'Explicitly saved account notes. source_type records whether a note came from dictation, manual entry, or Assistant.';

-- Keep installed older clients working while devices roll forward to the Notes domain.
create view public.voice_notes
with (security_invoker = true)
as
select id, user_id, text, source_device_id, status, created_at, updated_at
from public.notes;

grant select, insert, update, delete on public.voice_notes to authenticated;
revoke all on public.voice_notes from anon;

commit;
