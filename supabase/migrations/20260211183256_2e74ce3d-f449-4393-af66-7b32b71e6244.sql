
-- Organizations table
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;

-- Organization members table
CREATE TYPE public.org_role AS ENUM ('owner', 'admin', 'member');

CREATE TABLE public.organization_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role org_role NOT NULL DEFAULT 'member',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(organization_id, user_id)
);

ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;

-- Organization invites table
CREATE TYPE public.invite_status AS ENUM ('pending', 'accepted', 'declined', 'expired');

CREATE TABLE public.organization_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email text NOT NULL,
  invited_by uuid NOT NULL,
  status invite_status NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;

-- Add organization_id to profiles
ALTER TABLE public.profiles ADD COLUMN organization_id uuid REFERENCES public.organizations(id);

-- RLS: Organizations - members can view their org
CREATE POLICY "Members can view their organization"
ON public.organizations FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.organization_members
  WHERE organization_members.organization_id = organizations.id
  AND organization_members.user_id = auth.uid()
));

-- RLS: Organizations - authenticated users can create
CREATE POLICY "Authenticated users can create organizations"
ON public.organizations FOR INSERT
WITH CHECK (auth.uid() = created_by);

-- RLS: Organizations - owners/admins can update
CREATE POLICY "Owners can update organization"
ON public.organizations FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.organization_members
  WHERE organization_members.organization_id = organizations.id
  AND organization_members.user_id = auth.uid()
  AND organization_members.role IN ('owner', 'admin')
));

-- RLS: Organization members - members can view their org members
CREATE POLICY "Members can view org members"
ON public.organization_members FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.organization_id = organization_members.organization_id
  AND om.user_id = auth.uid()
));

-- RLS: Organization members - authenticated can insert (for creating org)
CREATE POLICY "Users can join organizations"
ON public.organization_members FOR INSERT
WITH CHECK (auth.uid() = user_id);

-- RLS: Organization members - owners can delete members
CREATE POLICY "Owners can remove members"
ON public.organization_members FOR DELETE
USING (EXISTS (
  SELECT 1 FROM public.organization_members om
  WHERE om.organization_id = organization_members.organization_id
  AND om.user_id = auth.uid()
  AND om.role = 'owner'
));

-- RLS: Invites - org members can view invites for their org
CREATE POLICY "Members can view org invites"
ON public.organization_invites FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = organization_invites.organization_id
    AND organization_members.user_id = auth.uid()
  )
  OR email = (SELECT email FROM auth.users WHERE id = auth.uid())
);

-- RLS: Invites - admins/owners can create invites
CREATE POLICY "Admins can create invites"
ON public.organization_invites FOR INSERT
WITH CHECK (
  auth.uid() = invited_by
  AND EXISTS (
    SELECT 1 FROM public.organization_members
    WHERE organization_members.organization_id = organization_invites.organization_id
    AND organization_members.user_id = auth.uid()
    AND organization_members.role IN ('owner', 'admin')
  )
);

-- RLS: Invites - invited user can update (accept/decline)
CREATE POLICY "Invited users can respond to invites"
ON public.organization_invites FOR UPDATE
USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Trigger for updated_at on organizations
CREATE TRIGGER update_organizations_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Trigger for updated_at on invites
CREATE TRIGGER update_invites_updated_at
BEFORE UPDATE ON public.organization_invites
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
