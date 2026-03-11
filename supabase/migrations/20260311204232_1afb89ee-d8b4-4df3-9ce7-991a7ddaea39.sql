CREATE OR REPLACE FUNCTION public.create_organization_with_owner(org_name text)
RETURNS public.organizations
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user_id uuid;
  _base text;
  _slug text;
  _org public.organizations;
BEGIN
  _user_id := auth.uid();

  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF org_name IS NULL OR btrim(org_name) = '' THEN
    RAISE EXCEPTION 'Organization name is required';
  END IF;

  _base := regexp_replace(lower(btrim(org_name)), '[^a-z0-9]+', '-', 'g');
  _base := regexp_replace(_base, '(^-|-$)', '', 'g');
  IF _base = '' THEN
    _base := 'org';
  END IF;

  _slug := _base || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES (btrim(org_name), _slug, _user_id)
  RETURNING * INTO _org;

  INSERT INTO public.organization_members (organization_id, user_id, role)
  VALUES (_org.id, _user_id, 'owner')
  ON CONFLICT (organization_id, user_id)
  DO UPDATE SET role = EXCLUDED.role;

  INSERT INTO public.profiles (id, organization_id, full_name)
  VALUES (
    _user_id,
    _org.id,
    COALESCE(auth.jwt() -> 'user_metadata' ->> 'full_name', NULL)
  )
  ON CONFLICT (id)
  DO UPDATE SET
    organization_id = EXCLUDED.organization_id,
    updated_at = now();

  RETURN _org;
END;
$$;

REVOKE ALL ON FUNCTION public.create_organization_with_owner(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_organization_with_owner(text) TO authenticated;