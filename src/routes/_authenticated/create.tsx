import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Download, Lock, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { RESOLUTIONS, RES_PIXEL_RATIO, RES_LABEL, isUnlocked, type Resolution } from "@/lib/resolutions";

export const Route = createFileRoute("/_authenticated/create")({
  head: () => ({ meta: [{ title: "Create Point Table — Point Arena" }] }),
  component: Create,
});

type Row = { name: string; kills: number; pos: number };
type Template = { id: string; name: string; image_url: string; accent_color: string; premium: boolean };

// Fixed export canvas — same on phone & PC
const CANVAS_W = 1080;
const CANVAS_H = 1350;

function Create() {
  const { user, profile, refresh } = useAuth();
  const userMax: Resolution = (profile?.max_resolution ?? "244p") as Resolution;
  const [tournament, setTournament] = useState("Point Arena Championship");
  const [textColor, setTextColor] = useState("#ffffff");
  const [tagColor, setTagColor] = useState("#f59e0b");
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 12 }, (_, i) => ({ name: `Team ${i + 1}`, kills: 0, pos: 0 })),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [tplId, setTplId] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("templates").select("id,name,image_url,accent_color,premium")
      .eq("active", true).order("created_at", { ascending: false })
      .then(({ data }) => setTemplates((data ?? []) as Template[]));
  }, []);

  const tpl = templates.find((t) => t.id === tplId) ?? null;
  const accent = tpl?.accent_color ?? "#34d399"; // default neon green

  const ranked = useMemo(() => rows.map((r, idx) => ({ ...r, idx, total: r.kills + r.pos }))
    .sort((a, b) => b.total - a.total || b.kills - a.kills), [rows]);
  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const download = async (resolution: Resolution) => {
    if (!ref.current || !user) return;
    if (!isUnlocked(resolution, userMax)) {
      return toast.error("Upgrade your credits package to unlock this resolution.");
    }
    try {
      const { data, error } = await supabase.rpc("spend_credit_for_download", {
        _table_id: null as unknown as string,
        _resolution: resolution,
      });
      if (error) {
        if (String(error.message).includes("INSUFFICIENT_CREDITS"))
          return toast.error("You need credits to download. Buy a pack from the Credits page.");
        if (String(error.message).includes("RESOLUTION_LOCKED"))
          return toast.error("Upgrade your credits package to unlock this resolution.");
        throw error;
      }
      // Fixed canvas size → identical output on phone and PC
      const dataUrl = await toPng(ref.current, {
        pixelRatio: RES_PIXEL_RATIO[resolution],
        cacheBust: true,
        width: CANVAS_W,
        height: CANVAS_H,
        backgroundColor: tpl ? undefined : "transparent",
        style: { transform: "none" },
      });
      await supabase.from("point_tables").insert({
        user_id: user.id, tournament_name: tournament, data: { rows: ranked },
      });
      const a = document.createElement("a");
      a.href = dataUrl; a.download = `${tournament.replace(/\s+/g, "_")}_${resolution}.png`; a.click();
      toast.success(`Downloaded! ${data} credits left.`);
      setPickerOpen(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  return (
    <div className="grid gap-8 lg:grid-cols-[420px_1fr]">
      <div className="glass rounded-2xl p-6 space-y-4">
        <div>
          <label className="text-sm text-muted-foreground">Tournament Name</label>
          <Input value={tournament} onChange={(e) => setTournament(e.target.value)} className="mt-1" />
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Text Color (all text)</label>
          <div className="flex gap-2 items-center mt-1">
            <Input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-16 h-10 p-1" />
            <Input value={textColor} onChange={(e) => setTextColor(e.target.value)} placeholder="#ffffff" />
          </div>
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Tag Color (Rank/Team/Kills/Pos/Total & #1 & totals)</label>
          <div className="flex gap-2 items-center mt-1">
            <Input type="color" value={tagColor} onChange={(e) => setTagColor(e.target.value)} className="w-16 h-10 p-1" />
            <Input value={tagColor} onChange={(e) => setTagColor(e.target.value)} placeholder="#f59e0b" />
          </div>
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Template</label>
          <div className="mt-1 grid grid-cols-3 gap-2 max-h-44 overflow-y-auto">
            <button onClick={() => setTplId(null)}
              className={`relative h-16 rounded-lg border-2 text-[10px] font-semibold ${tplId === null ? "border-primary" : "border-border"}`}
              style={{ background: "transparent" }}>
              None
            </button>
            {templates.map((t) => (
              <button key={t.id} onClick={() => setTplId(t.id)}
                className={`relative h-16 rounded-lg border-2 overflow-hidden ${tplId === t.id ? "border-primary" : "border-border"}`}
                title={t.name}>
                <img src={t.image_url} alt={t.name} className="absolute inset-0 w-full h-full object-cover" />
                <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[10px] px-1 truncate text-white">{t.name}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="max-h-[60vh] overflow-y-auto space-y-2 pr-1">
          {rows.map((r, i) => (
            <div key={i} className="grid grid-cols-[1fr_60px_60px] gap-2">
              <Input value={r.name} onChange={(e) => update(i, { name: e.target.value })} placeholder={`Team ${i + 1}`} />
              <Input type="number" min={0} value={r.kills} onChange={(e) => update(i, { kills: Number(e.target.value) || 0 })} placeholder="K" />
              <Input type="number" min={0} value={r.pos} onChange={(e) => update(i, { pos: Number(e.target.value) || 0 })} placeholder="P" />
            </div>
          ))}
        </div>
        <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
          <DialogTrigger asChild>
            <Button className="w-full neon-border h-11">
              <Download className="h-4 w-4 mr-2" /> Download (1 credit)
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Choose download quality</DialogTitle></DialogHeader>
            <p className="text-sm text-muted-foreground -mt-2">Your plan unlocks up to <span className="neon-text font-bold">{userMax.toUpperCase()}</span>.</p>
            <div className="grid grid-cols-2 gap-3 mt-2">
              {RESOLUTIONS.map((r) => {
                const unlocked = isUnlocked(r, userMax);
                return (
                  <button
                    key={r}
                    onClick={() => unlocked ? download(r) : toast.error("Upgrade your credits package to unlock this resolution.")}
                    className={`relative glass rounded-xl p-4 text-left transition ${unlocked ? "hover:neon-border cursor-pointer" : "opacity-60 cursor-not-allowed"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-bold">{RES_LABEL[r]}</span>
                      {unlocked ? <Sparkles className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4 text-muted-foreground" />}
                    </div>
                    {!unlocked && <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">Premium · Upgrade</div>}
                  </button>
                );
              })}
            </div>
          </DialogContent>
        </Dialog>
      </div>
      <PreviewArea
        canvasW={CANVAS_W}
        canvasH={CANVAS_H}
        innerRef={ref}
        tpl={tpl}
        textColor={textColor}
      >
        <h2 className="text-center font-black tracking-tight"
          style={{ color: accent, textShadow: `0 0 24px ${accent}80`, fontSize: 64 }}>
          {tournament}
        </h2>
              <p className="text-center uppercase mt-2" style={{ letterSpacing: 6, fontSize: 18, color: textColor, opacity: 0.85 }}>
                Official Point Table
              </p>
              <div className="mt-10 rounded-2xl overflow-hidden"
                style={{
                  background: tpl ? "rgba(0,0,0,0.35)" : "rgba(15,23,42,0.6)",
                  backdropFilter: "blur(10px)",
                  border: `1px solid ${accent}40`,
                }}>
                <div className="grid items-center px-6 py-4 font-bold uppercase"
                  style={{ gridTemplateColumns: "90px 1fr 110px 110px 130px", fontSize: 18, color: tagColor, background: `${tagColor}1A`, letterSpacing: 2 }}>
                  <div>Rank</div><div>Team</div><div className="text-center">Kills</div><div className="text-center">Pos</div><div className="text-right">Total</div>
                </div>
                {ranked.map((r, i) => (
                  <div key={r.idx} className="grid items-center px-6 py-3"
                    style={{ gridTemplateColumns: "90px 1fr 110px 110px 130px", fontSize: 22, borderTop: "1px solid rgba(255,255,255,0.08)", background: i === 0 ? `${tagColor}14` : "transparent" }}>
                    <div className="font-black" style={{ fontSize: 24, color: i === 0 ? tagColor : textColor, textShadow: i === 0 ? `0 0 14px ${tagColor}99` : "none" }}>#{i + 1}</div>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-center">{r.kills}</div>
                    <div className="text-center">{r.pos}</div>
                    <div className="text-right font-bold" style={{ color: tagColor }}>{r.total}</div>
                  </div>
                ))}
              </div>
      </PreviewArea>
    </div>
  );
}

function PreviewArea({
  canvasW, canvasH, innerRef, tpl, textColor, children,
}: {
  canvasW: number; canvasH: number;
  innerRef: React.RefObject<HTMLDivElement | null>;
  tpl: Template | null;
  textColor: string;
  children: React.ReactNode;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(0.5);
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / canvasW));
    ro.observe(el);
    return () => ro.disconnect();
  }, [canvasW]);
  return (
    <div ref={wrapRef} className="mx-auto w-full max-w-[540px]">
      <div className="relative" style={{ aspectRatio: `${canvasW} / ${canvasH}` }}>
        <div
          ref={innerRef}
          style={{
            width: canvasW,
            height: canvasH,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
            background: tpl ? `url(${tpl.image_url}) center/cover no-repeat` : "transparent",
            padding: 80,
            boxSizing: "border-box",
            color: textColor,
            position: "absolute",
            top: 0, left: 0,
          }}
        >
          {children}
        </div>
      </div>
    </div>
  );
}
