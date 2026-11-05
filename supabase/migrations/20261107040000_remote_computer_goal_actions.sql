-- PR45: Signed paired Device Link can start, inspect or stop the existing Windows Computer Use loop.
-- This is a command allowlist only, not permission to bypass the Windows goal-start approval.
-- Goal progress lives in the running Windows app; no screenshots or action arguments are stored here.
alter table public.device_action_requests
  drop constraint if exists device_action_requests_action_check;

alter table public.device_action_requests
  add constraint device_action_requests_action_check
  check (action in (
    'open_app', 'press_shortcut', 'insert_text',
    'move_pointer', 'click_pointer', 'double_click_pointer',
    'right_click_pointer', 'drag_pointer',
    'start_computer_goal', 'computer_goal_status', 'stop_computer_goal'
  ));
