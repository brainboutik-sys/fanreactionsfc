create table frfc_contact_messages (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  email text not null,
  subject text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table frfc_contact_messages enable row level security;

-- Anyone can submit a contact message; nobody (not even authenticated users)
-- can read them back via the API — admin reviews via email + this table
-- directly in the Supabase dashboard.
create policy "anyone can submit a contact message" on frfc_contact_messages
  for insert with check (true);

create or replace function notify_new_contact_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform net.http_post(
    url := 'https://dsxijgrpxsfywxuffbmt.supabase.co/functions/v1/notify-contact',
    body := jsonb_build_object('record', row_to_json(NEW)),
    headers := '{"Content-Type": "application/json"}'::jsonb
  );
  return new;
exception when others then
  raise warning 'Contact message notification failed: %', sqlerrm;
  return new;
end;
$$;

create trigger on_new_contact_message
  after insert on frfc_contact_messages
  for each row execute function notify_new_contact_message();