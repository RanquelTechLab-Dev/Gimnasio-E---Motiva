alter table public.training_notes
  add column if not exists note_type text not null default 'observation',
  add column if not exists visible_to_student boolean not null default false,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists archived_at timestamptz;

alter table public.training_notes
  drop constraint if exists training_notes_note_type_check;

alter table public.training_notes
  add constraint training_notes_note_type_check
  check (note_type in ('training_plan', 'observation', 'follow_up', 'admin_note'));

alter table public.files
  add column if not exists description text,
  add column if not exists visible_to_student boolean not null default false,
  add column if not exists updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists archived_at timestamptz;

create index if not exists training_notes_student_type_idx
  on public.training_notes (student_id, note_type, archived_at);

create index if not exists training_notes_visible_student_idx
  on public.training_notes (student_id, visible_to_student)
  where archived_at is null;

create index if not exists files_student_visible_idx
  on public.files (student_id, visible_to_student)
  where archived_at is null;

drop policy if exists "training_notes select access" on public.training_notes;
drop policy if exists "training_notes student select own" on public.training_notes;
drop policy if exists "files select access" on public.files;
drop policy if exists "files student select own" on public.files;

create policy "training_notes select access"
on public.training_notes
for select
to authenticated
using (
  (select private.is_admin())
  or (
    student_id = (select auth.uid())
    and visible_to_student = true
    and archived_at is null
  )
);

create policy "files select access"
on public.files
for select
to authenticated
using (
  (select private.is_admin())
  or (
    student_id = (select auth.uid())
    and visible_to_student = true
    and archived_at is null
  )
);

create or replace function private.ensure_admin()
returns uuid
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null or not private.is_admin() then
    raise exception 'Se requiere perfil admin activo.';
  end if;

  return v_actor;
end;
$$;

revoke all on function private.ensure_admin() from public, anon;
grant execute on function private.ensure_admin() to authenticated;

create or replace function private.ensure_student_exists(p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public, private
as $$
begin
  if not exists (
    select 1
    from public.profiles p
    where p.id = p_student_id
      and p.role = 'student'
  ) then
    raise exception 'No se encontro el alumno.';
  end if;
end;
$$;

revoke all on function private.ensure_student_exists(uuid) from public, anon;
grant execute on function private.ensure_student_exists(uuid) to authenticated;

create or replace function public.admin_list_student_training_notes(p_student_id uuid)
returns table (
  note_id uuid,
  student_id uuid,
  note_type text,
  title text,
  body text,
  visible_to_student boolean,
  created_by uuid,
  created_by_name text,
  updated_by uuid,
  updated_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
begin
  v_actor := private.ensure_admin();
  perform private.ensure_student_exists(p_student_id);

  return query
  select
    tn.id,
    tn.student_id,
    tn.note_type,
    tn.title,
    tn.body,
    tn.visible_to_student,
    tn.created_by,
    nullif(btrim(concat_ws(' ', cb.first_name, cb.last_name)), '') as created_by_name,
    tn.updated_by,
    nullif(btrim(concat_ws(' ', ub.first_name, ub.last_name)), '') as updated_by_name,
    tn.created_at,
    tn.updated_at,
    tn.archived_at
  from public.training_notes tn
  left join public.profiles cb on cb.id = tn.created_by
  left join public.profiles ub on ub.id = tn.updated_by
  where tn.student_id = p_student_id
  order by
    case when tn.archived_at is null then 0 else 1 end,
    tn.updated_at desc,
    tn.created_at desc;
end;
$$;

create or replace function public.admin_upsert_training_note(
  note_id uuid default null,
  student_id uuid default null,
  note_type text default 'observation',
  title text default null,
  body text default null,
  visible_to_student boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_note public.training_notes%rowtype;
  v_previous public.training_notes%rowtype;
  v_action text;
  v_student_id uuid;
  v_note_type text := coalesce(nullif(btrim(admin_upsert_training_note.note_type), ''), 'observation');
begin
  v_actor := private.ensure_admin();

  if v_note_type not in ('training_plan', 'observation', 'follow_up', 'admin_note') then
    raise exception 'Tipo de nota invalido.';
  end if;

  if nullif(btrim(coalesce(admin_upsert_training_note.title, '')), '') is null then
    raise exception 'El titulo es obligatorio.';
  end if;

  if admin_upsert_training_note.note_id is null then
    if admin_upsert_training_note.student_id is null then
      raise exception 'El alumno es obligatorio.';
    end if;

    perform private.ensure_student_exists(admin_upsert_training_note.student_id);

    insert into public.training_notes (
      student_id,
      note_type,
      title,
      body,
      visible_to_student,
      created_by,
      updated_by
    )
    values (
      admin_upsert_training_note.student_id,
      v_note_type,
      btrim(admin_upsert_training_note.title),
      nullif(btrim(coalesce(admin_upsert_training_note.body, '')), ''),
      coalesce(admin_upsert_training_note.visible_to_student, false),
      v_actor,
      v_actor
    )
    returning * into v_note;

    v_action := 'training_note.created';
  else
    select * into v_previous
    from public.training_notes tn
    where tn.id = admin_upsert_training_note.note_id
    for update;

    if not found then
      raise exception 'No se encontro la nota.';
    end if;

    v_student_id := coalesce(admin_upsert_training_note.student_id, v_previous.student_id);
    if v_student_id <> v_previous.student_id then
      raise exception 'No se puede mover una nota a otro alumno.';
    end if;

    update public.training_notes tn
    set
      note_type = v_note_type,
      title = btrim(admin_upsert_training_note.title),
      body = nullif(btrim(coalesce(admin_upsert_training_note.body, '')), ''),
      visible_to_student = coalesce(admin_upsert_training_note.visible_to_student, false),
      updated_by = v_actor,
      updated_at = now()
    where tn.id = admin_upsert_training_note.note_id
    returning * into v_note;

    v_action := 'training_note.updated';
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'training_note',
    v_note.id,
    v_action,
    jsonb_build_object(
      'student_id', v_note.student_id,
      'note_type', v_note.note_type,
      'title', v_note.title,
      'visible_to_student', v_note.visible_to_student,
      'previous_note_type', v_previous.note_type,
      'previous_title', v_previous.title,
      'previous_visible_to_student', v_previous.visible_to_student
    )
  );

  return to_jsonb(v_note);
end;
$$;

create or replace function public.admin_archive_training_note(note_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_note public.training_notes%rowtype;
begin
  v_actor := private.ensure_admin();

  update public.training_notes tn
  set
    archived_at = coalesce(tn.archived_at, now()),
    updated_by = v_actor,
    updated_at = now()
  where tn.id = admin_archive_training_note.note_id
  returning * into v_note;

  if not found then
    raise exception 'No se encontro la nota.';
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'training_note',
    v_note.id,
    'training_note.archived',
    jsonb_build_object(
      'student_id', v_note.student_id,
      'note_type', v_note.note_type,
      'title', v_note.title
    )
  );

  return to_jsonb(v_note);
end;
$$;

create or replace function public.admin_list_student_files(p_student_id uuid)
returns table (
  file_id uuid,
  student_id uuid,
  kind public.file_kind,
  title text,
  description text,
  drive_url text,
  mime_type text,
  size_bytes bigint,
  visible_to_student boolean,
  uploaded_by uuid,
  uploaded_by_name text,
  updated_by uuid,
  updated_by_name text,
  created_at timestamptz,
  updated_at timestamptz,
  archived_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
begin
  v_actor := private.ensure_admin();
  perform private.ensure_student_exists(p_student_id);

  return query
  select
    f.id,
    f.student_id,
    f.kind,
    f.title,
    f.description,
    f.drive_url,
    f.mime_type,
    f.size_bytes,
    f.visible_to_student,
    f.uploaded_by,
    nullif(btrim(concat_ws(' ', cb.first_name, cb.last_name)), '') as uploaded_by_name,
    f.updated_by,
    nullif(btrim(concat_ws(' ', ub.first_name, ub.last_name)), '') as updated_by_name,
    f.created_at,
    f.updated_at,
    f.archived_at
  from public.files f
  left join public.profiles cb on cb.id = f.uploaded_by
  left join public.profiles ub on ub.id = f.updated_by
  where f.student_id = p_student_id
  order by
    case when f.archived_at is null then 0 else 1 end,
    f.updated_at desc,
    f.created_at desc;
end;
$$;

create or replace function public.admin_create_student_file_metadata(
  student_id uuid,
  kind public.file_kind,
  title text,
  drive_url text default null,
  description text default null,
  mime_type text default null,
  size_bytes bigint default null,
  visible_to_student boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_file public.files%rowtype;
begin
  v_actor := private.ensure_admin();
  perform private.ensure_student_exists(admin_create_student_file_metadata.student_id);

  if nullif(btrim(coalesce(admin_create_student_file_metadata.title, '')), '') is null then
    raise exception 'El titulo es obligatorio.';
  end if;

  if admin_create_student_file_metadata.size_bytes is not null
    and admin_create_student_file_metadata.size_bytes < 0 then
    raise exception 'El tamano no puede ser negativo.';
  end if;

  insert into public.files (
    student_id,
    kind,
    title,
    drive_url,
    description,
    mime_type,
    size_bytes,
    visible_to_student,
    uploaded_by,
    updated_by
  )
  values (
    admin_create_student_file_metadata.student_id,
    admin_create_student_file_metadata.kind,
    btrim(admin_create_student_file_metadata.title),
    nullif(btrim(coalesce(admin_create_student_file_metadata.drive_url, '')), ''),
    nullif(btrim(coalesce(admin_create_student_file_metadata.description, '')), ''),
    nullif(btrim(coalesce(admin_create_student_file_metadata.mime_type, '')), ''),
    admin_create_student_file_metadata.size_bytes,
    coalesce(admin_create_student_file_metadata.visible_to_student, false),
    v_actor,
    v_actor
  )
  returning * into v_file;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'file',
    v_file.id,
    'file_metadata.created',
    jsonb_build_object(
      'student_id', v_file.student_id,
      'kind', v_file.kind,
      'title', v_file.title,
      'visible_to_student', v_file.visible_to_student,
      'has_drive_url', v_file.drive_url is not null
    )
  );

  return to_jsonb(v_file);
end;
$$;

create or replace function public.admin_update_student_file_metadata(
  file_id uuid,
  kind public.file_kind,
  title text,
  drive_url text default null,
  description text default null,
  mime_type text default null,
  size_bytes bigint default null,
  visible_to_student boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_file public.files%rowtype;
  v_previous public.files%rowtype;
begin
  v_actor := private.ensure_admin();

  select * into v_previous
  from public.files f
  where f.id = admin_update_student_file_metadata.file_id
  for update;

  if not found then
    raise exception 'No se encontro el archivo.';
  end if;

  if nullif(btrim(coalesce(admin_update_student_file_metadata.title, '')), '') is null then
    raise exception 'El titulo es obligatorio.';
  end if;

  if admin_update_student_file_metadata.size_bytes is not null
    and admin_update_student_file_metadata.size_bytes < 0 then
    raise exception 'El tamano no puede ser negativo.';
  end if;

  update public.files f
  set
    kind = admin_update_student_file_metadata.kind,
    title = btrim(admin_update_student_file_metadata.title),
    drive_url = nullif(btrim(coalesce(admin_update_student_file_metadata.drive_url, '')), ''),
    description = nullif(btrim(coalesce(admin_update_student_file_metadata.description, '')), ''),
    mime_type = nullif(btrim(coalesce(admin_update_student_file_metadata.mime_type, '')), ''),
    size_bytes = admin_update_student_file_metadata.size_bytes,
    visible_to_student = coalesce(admin_update_student_file_metadata.visible_to_student, false),
    updated_by = v_actor,
    updated_at = now()
  where f.id = admin_update_student_file_metadata.file_id
  returning * into v_file;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'file',
    v_file.id,
    'file_metadata.updated',
    jsonb_build_object(
      'student_id', v_file.student_id,
      'kind', v_file.kind,
      'title', v_file.title,
      'visible_to_student', v_file.visible_to_student,
      'previous_kind', v_previous.kind,
      'previous_title', v_previous.title,
      'previous_visible_to_student', v_previous.visible_to_student,
      'has_drive_url', v_file.drive_url is not null
    )
  );

  return to_jsonb(v_file);
end;
$$;

create or replace function public.admin_archive_student_file_metadata(file_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid;
  v_file public.files%rowtype;
begin
  v_actor := private.ensure_admin();

  update public.files f
  set
    archived_at = coalesce(f.archived_at, now()),
    updated_by = v_actor,
    updated_at = now()
  where f.id = admin_archive_student_file_metadata.file_id
  returning * into v_file;

  if not found then
    raise exception 'No se encontro el archivo.';
  end if;

  insert into public.audit_logs (actor_id, entity_type, entity_id, action, metadata)
  values (
    v_actor,
    'file',
    v_file.id,
    'file_metadata.archived',
    jsonb_build_object(
      'student_id', v_file.student_id,
      'kind', v_file.kind,
      'title', v_file.title,
      'visible_to_student', v_file.visible_to_student
    )
  );

  return to_jsonb(v_file);
end;
$$;

drop function if exists public.list_my_files();

create function public.list_my_files()
returns table (
  file_id uuid,
  kind public.file_kind,
  title text,
  description text,
  drive_url text,
  mime_type text,
  size_bytes bigint,
  visible_to_student boolean,
  created_at timestamptz
)
language plpgsql
security definer
set search_path = public, private
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'Se requiere sesion activa.';
  end if;

  return query
  select
    f.id,
    f.kind,
    f.title,
    f.description,
    f.drive_url,
    f.mime_type,
    f.size_bytes,
    f.visible_to_student,
    f.created_at
  from public.files f
  where f.student_id = v_actor
    and f.visible_to_student = true
    and f.archived_at is null
  union all
  select
    tn.id,
    'training_plan'::public.file_kind,
    tn.title,
    tn.body,
    null::text,
    null::text,
    null::bigint,
    tn.visible_to_student,
    tn.created_at
  from public.training_notes tn
  where tn.student_id = v_actor
    and tn.note_type = 'training_plan'
    and tn.visible_to_student = true
    and tn.archived_at is null
  order by created_at desc;
end;
$$;

revoke all on function public.admin_list_student_training_notes(uuid) from public, anon;
revoke all on function public.admin_upsert_training_note(uuid, uuid, text, text, text, boolean) from public, anon;
revoke all on function public.admin_archive_training_note(uuid) from public, anon;
revoke all on function public.admin_list_student_files(uuid) from public, anon;
revoke all on function public.admin_create_student_file_metadata(uuid, public.file_kind, text, text, text, text, bigint, boolean) from public, anon;
revoke all on function public.admin_update_student_file_metadata(uuid, public.file_kind, text, text, text, text, bigint, boolean) from public, anon;
revoke all on function public.admin_archive_student_file_metadata(uuid) from public, anon;
revoke all on function public.list_my_files() from public, anon;

grant execute on function public.admin_list_student_training_notes(uuid) to authenticated;
grant execute on function public.admin_upsert_training_note(uuid, uuid, text, text, text, boolean) to authenticated;
grant execute on function public.admin_archive_training_note(uuid) to authenticated;
grant execute on function public.admin_list_student_files(uuid) to authenticated;
grant execute on function public.admin_create_student_file_metadata(uuid, public.file_kind, text, text, text, text, bigint, boolean) to authenticated;
grant execute on function public.admin_update_student_file_metadata(uuid, public.file_kind, text, text, text, text, bigint, boolean) to authenticated;
grant execute on function public.admin_archive_student_file_metadata(uuid) to authenticated;
grant execute on function public.list_my_files() to authenticated;
