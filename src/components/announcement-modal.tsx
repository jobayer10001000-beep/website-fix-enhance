import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Megaphone } from "lucide-react";

type Announcement = { text: string; version: string };

const STORAGE_KEY = "pa_announcement_seen";

export function AnnouncementModal() {
  const [ann, setAnn] = useState<Announcement | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    supabase.from("app_settings").select("value").eq("key", "site_announcement").maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data?.value) return;
        const v = data.value as Partial<Announcement>;
        if (!v.text || !v.version) return;
        const seen = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
        if (seen === v.version) return;
        setAnn({ text: v.text, version: v.version });
        setOpen(true);
      });
    return () => { cancelled = true; };
  }, []);

  const dismiss = () => {
    if (ann) localStorage.setItem(STORAGE_KEY, ann.version);
    setOpen(false);
  };

  if (!ann) return null;
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Megaphone className="h-5 w-5 text-primary" /> Announcement
          </DialogTitle>
        </DialogHeader>
        <div className="whitespace-pre-wrap text-sm leading-relaxed py-2">{ann.text}</div>
        <DialogFooter>
          <Button className="w-full neon-border" onClick={dismiss}>Got it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
