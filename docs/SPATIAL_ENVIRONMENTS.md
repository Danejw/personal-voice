# Account-owned 3D environments (experimental)

This PR builds on `codex/3d-background`, not `main`. It adds account-owned
environment records and a first Settings interface. It does **not** add World Labs
imports, executable spatial objects, multiplayer, or agent sessions.

## Data model

- `spatial_environments`: one owner, UUID, name, saved safe scene descriptor.
- `spatial_environment_selection`: one active world per account, constrained by
  composite foreign key to an environment with the same owner.
- `spatial_environment_objects`: owned placeholder records for future typed
  model, note, and agent-link objects. No runtime execution or object editor yet.
- Row-level security restricts every table to its authenticated owner.
  Cascade deletion removes an environment's selection and saved objects.

Apply `supabase/migrations/20261113000000_spatial_environments.sql` before
testing the signed-in UI. The migration has **not** been applied by this PR.

## Current behavior

On Windows Settings > Devices & Controls > 3D desktop background, signed-in
users can create, rename, select, recolor, or delete private environments.
Selecting a world persists on the account. Its cyan, violet, or amber palette
is projected into every monitor of the existing Three.js terrain. Changing an
active world updates running surfaces through a narrow native event. The scene
entry does not load Supabase, auth, or the application.

The native IPC accepts only allowlisted palettes from the main Settings window;
wallpaper WebViews retain the existing command denylist. If Supabase is
unconfigured or unavailable, the original cyan terrain remains usable. World
descriptors contain no secrets, scripts, or agent tokens.

Only one world renders at a time. Saving imported 3D assets, arbitrary object
transforms, agent processes, cameras, and sessions are subsequent milestones.

## Verification checklist

- Run migration in the configured Supabase project and verify three tables'
  RLS policies and ownership/foreign key constraints.
- Run `pnpm check`, `pnpm build`, and Windows `cargo check --locked`.
  These have **not** been run for this PR by the GitHub connector.
- Sign in as A; create two worlds, rename them, change their palettes, and
  select one. Reload Settings and restart Personal Voice: saved worlds and
  selection should remain. The background toggle remains off at launch.
- Enable the background across three monitors; select different worlds and
  verify the palette changes consistently on all three without a window seam,
  changing icon z-order, or interrupting dictation.
- Sign in as B; A's environments and objects must not be visible, writable,
  selectable, or deletable even with handcrafted REST requests. An attempt to
  select another owner's environment must fail at the database foreign key.
- Delete the currently selected world and verify dependent selection and
  objects are deleted. Creating another world should work normally.
- Sign out / disconnect Supabase and verify background still works in default
  cyan without exposing prior account records.
- Test a malicious palette and unsupported scene kind; neither can be
  persisted or passed to the native renderer.

## Known limitations

This is a feature-foundation PR, not production-ready world management.
The current Three.js terrain is the only supported scene kind. Signed-in
CRUD is gated on deploying the migration. The current branch originates
from an older companion feature baseline, so reconciliation with `main`
is a separate review task. Windows visual, security, and lifecycle tests
require a real installed application and backend.
