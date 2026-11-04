-- The trigger runs as its definer when fired; clients must not invoke its RPC directly.
revoke all on function public.trusted_grant_guard() from public, anon, authenticated;
