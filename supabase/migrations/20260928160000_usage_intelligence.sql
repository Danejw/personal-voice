-- PV17: account opt-out for local usage counters. Totals stay on the device.
alter table public.settings
  add column usage_intelligence boolean not null default true;
