CREATE OR REPLACE FUNCTION public.hash_user_data(input TEXT)
RETURNS TEXT
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF input IS NULL OR input = '' THEN
    RETURN NULL;
  END IF;
  RETURN encode(extensions.digest(lower(trim(input)), 'sha256'), 'hex');
END;
$$;