-- Default Assistant memory/recall controls on for NEW accounts only.
-- Preserve all existing opt-outs. Dictation search still respects the
-- independent cloud_dictation_history gate and does not upload local history.
begin;
alter table public.settings
  alter column assistant_memory_learning set default true,
  alter column assistant_semantic_search set default true,
  alter column assistant_recall_notes set default true,
  alter column assistant_recall_dictations set default true;
commit;
