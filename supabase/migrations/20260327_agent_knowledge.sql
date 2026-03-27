create table if not exists public.agent_knowledge (
    id uuid default gen_random_uuid() primary key,
    user_id uuid not null references auth.users(id) on delete cascade,
    agent_id text not null,
    knowledge_text text not null,
    updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
    constraint agent_knowledge_user_agent_key unique (user_id, agent_id)
);

-- RLS Enable
alter table public.agent_knowledge enable row level security;

-- Policies
create policy "Users can view their own agent knowledge"
    on public.agent_knowledge for select
    using (auth.uid() = user_id);

create policy "Users can insert their own agent knowledge"
    on public.agent_knowledge for insert
    with check (auth.uid() = user_id);

create policy "Users can update their own agent knowledge"
    on public.agent_knowledge for update
    using (auth.uid() = user_id)
    with check (auth.uid() = user_id);

create policy "Users can delete their own agent knowledge"
    on public.agent_knowledge for delete
    using (auth.uid() = user_id);

-- Trigger for updated_at
create or replace function public.handle_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_updated_at on public.agent_knowledge;
create trigger set_updated_at
    before update on public.agent_knowledge
    for each row
    execute function public.handle_updated_at();
