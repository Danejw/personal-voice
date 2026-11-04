-- PR42: Paired signed Device Link requests may ask for bounded pointer actions.
-- The Windows receiver still requires its existing explicit per-action approval.
-- Existing trusted grants are deliberately NOT expanded to mouse commands.
alter table public.device_action_requests
  drop constraint if exists device_action_requests_action_check;

alter table public.device_action_requests
  add constraint device_action_requests_action_check
  check (action in (
    'open_app', 'press_shortcut', 'insert_text',
    'move_pointer', 'click_pointer', 'double_click_pointer',
    'right_click_pointer', 'drag_pointer'
  ));
