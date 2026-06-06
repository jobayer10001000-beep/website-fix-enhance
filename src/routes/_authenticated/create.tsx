import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { toPng } from "html-to-image";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Download, Lock, Sparkles, Upload, Trash2, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";
import { RESOLUTIONS, RES_PIXEL_RATIO, RES_LABEL, isUnlocked, type Resolution } from "@/lib/resolutions";

export const Route = createFileRoute("/_authenticated/create")({
  head: () => ({
    meta: [
      { title: "Create Point Table — Point Arena" },
      { name: "description", content: "Build live esports point tables: edit team names, kills and positions, then download HD images for your tournament." },
      { property: "og:title", content: "Create Point Table — Point Arena" },
      { property: "og:description", content: "Build live esports point tables and download HD images for your tournament." },
    ],
  }),
  component: Create,
});

type Row = { name: string; kills: number; pos: number; logo?: string | null };
type Template = { id: string; name: string; image_url: string; accent_color: string; premium: boolean; isUser?: boolean; locked?: boolean; storage_path?: string };

const CANVAS_W = 1080;
const CANVAS_H = 1350;
const NONE_BG = "radial-gradient(ellipse at top, #0c1c3e 0%, #050813 70%)";

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(file);
  });
}

function Create() {
  const { user, profile, refresh } = useAuth();
  const userMax: Resolution = (profile?.max_resolution ?? "244p") as Resolution;
  const canUpload = !!profile?.can_upload_thumbnails;
  const credits = profile?.credits ?? 0;

  const [tournament, setTournament] = useState("Point Arena Championship");
  const [textColor, setTextColor] = useState("#ffffff");
  const [tagColor, setTagColor] = useState("#f59e0b");
  const [tournamentLogo, setTournamentLogo] = useState<string | null>(null);
  const [tournamentLogoSize, setTournamentLogoSize] = useState(140);
  const [rows, setRows] = useState<Row[]>(
    Array.from({ length: 12 }, (_, i) => ({ name: `Team ${i + 1}`, kills: 0, pos: 0, logo: null })),
  );
  const [pickerOpen, setPickerOpen] = useState(false);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [userTpls, setUserTpls] = useState<Template[]>([]);
  const [tplId, setTplId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.from("templates").select("id,name,image_url,accent_color,premium")
      .eq("active", true).order("created_at", { ascending: false })
      .then(({ data }) => setTemplates((data ?? []) as Template[]));
  }, []);

  const loadUserThumbs = async () => {
    if (!user) return;
    const { data } = await supabase.from("user_thumbnails")
      .select("id,name,image_url,accent_color").eq("user_id", user.id)
      .order("created_at", { ascending: false });
    if (!data) return;
    const enriched = await Promise.all(data.map(async (t) => {
      const path = t.image_url;
      const { data: signed } = await supabase.storage.from("user-thumbnails").createSignedUrl(path, 3600);
      return {
        id: t.id, name: t.name, accent_color: t.accent_color, premium: false,
        image_url: signed?.signedUrl ?? "",
        storage_path: path,
        isUser: true,
        locked: credits <= 0,
      } as Template;
    }));
    setUserTpls(enriched);
  };

  useEffect(() => { loadUserThumbs(); }, [user?.id, credits]);

  const allTpls = useMemo(() => [...userTpls, ...templates], [userTpls, templates]);
  const tpl = allTpls.find((t) => t.id === tplId) ?? null;
  useEffect(() => {
    if (tpl?.isUser && tpl.locked) setTplId(null);
  }, [tpl]);

  const accent = tpl?.accent_color ?? "#34d399";

  const ranked = useMemo(() => rows.map((r, idx) => ({ ...r, idx, total: r.kills + r.pos }))
    .sort((a, b) => b.total - a.total || b.kills - a.kills), [rows]);
  const update = (i: number, patch: Partial<Row>) =>
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !user) return;
    if (!canUpload) return toast.error("You don't have thumbnail upload access.");
    if (file.size > 5 * 1024 * 1024) return toast.error("Max 5MB");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop() || "png";
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("user-thumbnails").upload(path, file);
      if (upErr) throw upErr;
      const { error: insErr } = await supabase.from("user_thumbnails").insert({
        user_id: user.id, name: file.name.replace(/\.[^.]+$/, "").slice(0, 40), image_url: path,
      });
      if (insErr) throw insErr;
      toast.success("Thumbnail uploaded");
      await loadUserThumbs();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const deleteThumb = async (t: Template) => {
    if (!confirm("Delete this thumbnail?")) return;
    if (t.storage_path) await supabase.storage.from("user-thumbnails").remove([t.storage_path]);
    await supabase.from("user_thumbnails").delete().eq("id", t.id);
    if (tplId === t.id) setTplId(null);
    loadUserThumbs();
  };

  const handleTeamLogo = async (i: number, file: File | undefined) => {
    if (!file) return;
    if (!canUpload) return toast.error("Logo upload is a premium feature.");
    if (file.size > 3 * 1024 * 1024) return toast.error("Logo max 3MB");
    try {
      const dataUrl = await fileToDataUrl(file);
      update(i, { logo: dataUrl });
    } catch {
      toast.error("Failed to read logo");
    }
  };

  const handleTournamentLogo = async (file: File | undefined) => {
    if (!file) return;
    if (!canUpload) return toast.error("Logo upload is a premium feature.");
    if (file.size > 5 * 1024 * 1024) return toast.error("Logo max 5MB");
    try {
      const dataUrl = await fileToDataUrl(file);
      setTournamentLogo(dataUrl);
    } catch {
      toast.error("Failed to read logo");
    }
  };

  const fetchAsDataUrl = async (url: string): Promise<string | null> => {
    try {
      const res = await fetch(url, { mode: "cors", cache: "no-store" });
      if (!res.ok) return null;
      const blob = await res.blob();
      return await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => resolve(null);
        r.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  };

  const renderPng = async (resolution: Resolution): Promise<string> => {
    const node = ref.current!;
    const originalBg = node.style.background;
    // Try to inline bg as data URL to avoid CORS taint
    let appliedDataBg = false;
    try {
      if (tpl?.image_url) {
        const dataUrl = await fetchAsDataUrl(tpl.image_url);
        if (dataUrl) {
          node.style.background = `url(${dataUrl}) center/cover no-repeat`;
          appliedDataBg = true;
        }
      }
      const opts = {
        pixelRatio: RES_PIXEL_RATIO[resolution],
        cacheBust: true,
        width: CANVAS_W,
        height: CANVAS_H,
        style: { transform: "none" },
        fetchRequestInit: { mode: "cors" as RequestMode, cache: "no-store" as RequestCache },
      };
      try {
        return await toPng(node, opts);
      } catch (firstErr) {
        // Fallback: drop the (possibly tainted) background and retry
        node.style.background = NONE_BG;
        try {
          return await toPng(node, opts);
        } catch (secondErr) {
          throw firstErr instanceof Error ? firstErr : secondErr;
        }
      }
    } finally {
      if (appliedDataBg) node.style.background = originalBg;
    }
  };

  const download = async (resolution: Resolution) => {
    if (!ref.current || !user) return;
    if (!isUnlocked(resolution, userMax)) {
      return toast.error("Upgrade your credits package to unlock this resolution.");
    }
    if (credits <= 0) {
      return toast.error("You need credits to download. Buy a pack from the Credits page.");
    }
    try {
      const pngDataUrl = await renderPng(resolution);

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

      await supabase.from("point_tables").insert({
        user_id: user.id, tournament_name: tournament, data: { rows: ranked },
      });
      const a = document.createElement("a");
      a.href = pngDataUrl; a.download = `${tournament.replace(/\s+/g, "_")}_${resolution}.png`; a.click();
      toast.success(typeof data === "number" ? `Downloaded! ${data} credits left.` : "Downloaded!");
      setPickerOpen(false);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    }
  };

  return (
    <>
      <h1 className="sr-only">Create Point Table</h1>
    <div className="grid gap-8 lg:grid-cols-[420px_1fr]">

      <div className="glass rounded-2xl p-6 space-y-4">
        <div>
          <label className="text-sm text-muted-foreground">Tournament Name</label>
          <Input value={tournament} onChange={(e) => setTournament(e.target.value)} className="mt-1" />
        </div>

        {/* Tournament logo (premium) */}
        <div>
          <label className="text-sm text-muted-foreground flex items-center gap-2">
            Tournament Logo {!canUpload && <Lock className="h-3 w-3" />}
            <span className="text-[10px] uppercase tracking-wider text-primary">Premium</span>
          </label>
          <div className="mt-1 flex items-center gap-2">
            <label className="flex-1">
              <input
                type="file" accept="image/*" hidden
                disabled={!canUpload}
                onChange={(e) => { handleTournamentLogo(e.target.files?.[0]); e.target.value = ""; }}
              />
              <Button asChild variant="outline" size="sm" className="w-full cursor-pointer" disabled={!canUpload}>
                <span><ImagePlus className="h-4 w-4 mr-1.5" />{tournamentLogo ? "Replace logo" : "Upload logo"}</span>
              </Button>
            </label>
            {tournamentLogo && (
              <Button variant="ghost" size="icon" onClick={() => setTournamentLogo(null)} aria-label="Remove logo">
                <X className="h-4 w-4" />
              </Button>
            )}
          </div>
          {tournamentLogo && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-xs text-muted-foreground w-10">Size</span>
              <input
                type="range" min={60} max={400} value={tournamentLogoSize}
                onChange={(e) => setTournamentLogoSize(Number(e.target.value))}
                className="flex-1 accent-primary"
              />
              <span className="text-xs text-muted-foreground w-10 text-right">{tournamentLogoSize}px</span>
            </div>
          )}
        </div>

        <div>
          <label className="text-sm text-muted-foreground">Text Color (all text)</label>
          <div className="flex gap-2 items-center mt-1">
            <Input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)} className="w-16 h-10 p-1" />
            <Input value={textColor} onChange={(e) => setTextColor(e.target.value)} placeholder="#ffffff" />
          </div>
        </div>
        <div>
          <label className="text-sm text-muted-foreground">Tag Color</label>
          <div className="flex gap-2 items-center mt-1">
            <Input type="color" value={tagColor} onChange={(e) => setTagColor(e.target.value)} className="w-16 h-10 p-1" />
            <Input value={tagColor} onChange={(e) => setTagColor(e.target.value)} placeholder="#f59e0b" />
          </div>
        </div>

        {canUpload && (
          <div>
            <label className="text-sm text-muted-foreground">Your Thumbnails</label>
            <div className="mt-1 flex items-center gap-2">
              <label className="flex-1">
                <input type="file" accept="image/*" hidden onChange={handleUpload} disabled={uploading} />
                <Button asChild variant="outline" size="sm" className="w-full cursor-pointer" disabled={uploading}>
                  <span><Upload className="h-4 w-4 mr-1.5" />{uploading ? "Uploading…" : "Upload your thumbnail"}</span>
                </Button>
              </label>
            </div>
            {credits <= 0 && userTpls.length > 0 && (
              <p className="text-[11px] text-destructive mt-1.5">Out of credits — your thumbnails are locked. Buy a pack to use them.</p>
            )}
          </div>
        )}

        <div>
          <label className="text-sm text-muted-foreground">Template</label>
          <div className="mt-1 grid grid-cols-3 gap-2 max-h-44 overflow-y-auto">
            <button onClick={() => setTplId(null)}
              className={`relative h-16 rounded-lg border-2 text-[10px] font-semibold ${tplId === null ? "border-primary" : "border-border"}`}
              style={{ background: "transparent" }}>
              None
            </button>
            {userTpls.map((t) => (
              <div key={t.id} className="relative group">
                <button
                  onClick={() => t.locked ? toast.error("Locked — buy credits to use your thumbnails.") : setTplId(t.id)}
                  className={`relative h-16 w-full rounded-lg border-2 overflow-hidden ${tplId === t.id ? "border-primary" : "border-primary/40"} ${t.locked ? "opacity-50" : ""}`}
                  title={t.name}>
                  <img src={t.image_url} alt={t.name} className="absolute inset-0 w-full h-full object-cover" />
                  {t.locked && <Lock className="absolute inset-0 m-auto h-5 w-5 text-white drop-shadow" />}
                  <span className="absolute bottom-0 left-0 right-0 bg-black/60 text-[9px] px-1 truncate text-white">★ {t.name}</span>
                </button>
                <button onClick={() => deleteThumb(t)}
                  aria-label={`Delete thumbnail ${t.name}`}
                  className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition">
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            ))}
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
            <div key={i} className="grid grid-cols-[40px_1fr_56px_56px] gap-2 items-center">
              <label
                className={`relative h-10 w-10 rounded border border-border flex items-center justify-center overflow-hidden ${canUpload ? "cursor-pointer hover:border-primary" : "opacity-60 cursor-not-allowed"}`}
                title={canUpload ? "Upload team logo (premium)" : "Premium feature"}
              >
                <input
                  type="file" accept="image/*" hidden disabled={!canUpload}
                  onChange={(e) => { handleTeamLogo(i, e.target.files?.[0]); e.target.value = ""; }}
                />
                {r.logo ? (
                  <>
                    <img src={r.logo} alt="" className="h-full w-full object-cover" />
                    <button
                      type="button"
                      onClick={(e) => { e.preventDefault(); update(i, { logo: null }); }}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5"
                      aria-label="Remove logo"
                    >
                      <X className="h-2.5 w-2.5" />
                    </button>
                  </>
                ) : canUpload ? <ImagePlus className="h-4 w-4 text-muted-foreground" /> : <Lock className="h-3 w-3 text-muted-foreground" />}
              </label>
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
        {tournamentLogo && (
          <div className="flex justify-center mb-4">
            <img
              src={tournamentLogo}
              alt="Tournament logo"
              style={{ height: tournamentLogoSize, width: "auto", objectFit: "contain" }}
              crossOrigin="anonymous"
            />
          </div>
        )}
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
                  style={{ gridTemplateColumns: "90px 70px 1fr 110px 110px 130px", fontSize: 18, color: tagColor, background: `${tagColor}1A`, letterSpacing: 2 }}>
                  <div>Rank</div><div>Logo</div><div>Team</div><div className="text-center">Kills</div><div className="text-center">Pos</div><div className="text-right">Total</div>
                </div>
                {ranked.map((r, i) => (
                  <div key={r.idx} className="grid items-center px-6 py-3"
                    style={{ gridTemplateColumns: "90px 70px 1fr 110px 110px 130px", fontSize: 22, borderTop: "1px solid rgba(255,255,255,0.08)", background: i === 0 ? `${tagColor}14` : "transparent" }}>
                    <div className="font-black" style={{ fontSize: 24, color: i === 0 ? tagColor : textColor, textShadow: i === 0 ? `0 0 14px ${tagColor}99` : "none" }}>#{i + 1}</div>
                    <div className="flex items-center">
                      {r.logo ? (
                        <img src={r.logo} alt="" style={{ height: 52, width: 52, objectFit: "cover", borderRadius: 8 }} />
                      ) : (
                        <div style={{ height: 52, width: 52 }} />
                      )}
                    </div>
                    <div className="font-semibold">{r.name}</div>
                    <div className="text-center">{r.kills}</div>
                    <div className="text-center">{r.pos}</div>
                    <div className="text-right font-bold" style={{ color: tagColor }}>{r.total}</div>
                  </div>
                ))}
              </div>
      </PreviewArea>
    </div>
    </>

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
            background: tpl ? `url(${tpl.image_url}) center/cover no-repeat` : NONE_BG,
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
