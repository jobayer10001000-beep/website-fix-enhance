
CREATE TYPE public.announcement_audience AS ENUM ('all','admin','user');

CREATE TABLE public.announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  body text NOT NULL,
  bg_color text NOT NULL DEFAULT '#0c1c3e',
  text_color text NOT NULL DEFAULT '#ffffff',
  audience public.announcement_audience NOT NULL DEFAULT 'all',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.announcements TO authenticated;
GRANT ALL ON public.announcements TO service_role;

ALTER TABLE public.announcements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read active by audience"
ON public.announcements FOR SELECT TO authenticated
USING (
  active = true AND (
    audience = 'all'
    OR (audience = 'admin' AND public.has_role(auth.uid(),'admin'))
    OR (audience = 'user'  AND NOT public.has_role(auth.uid(),'admin'))
    OR public.has_role(auth.uid(),'admin')
  )
);

CREATE POLICY "Admins manage announcements"
ON public.announcements FOR ALL TO authenticated
USING (public.has_role(auth.uid(),'admin'))
WITH CHECK (public.has_role(auth.uid(),'admin'));

CREATE TRIGGER announcements_touch_updated_at
  BEFORE UPDATE ON public.announcements
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
