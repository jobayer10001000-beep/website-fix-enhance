import { createFileRoute, Outlet, useNavigate, Link } from "@tanstack/react-router";
import { useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/_authenticated")({ component: Layout });

function Layout() {
  const { user, loading, profile, signOut, isAdmin, refresh } = useAuth();
  const nav = useNavigate();
  useEffect(() => { if (!loading && !user) nav({ to: "/auth" }); }, [loading, user, nav]);
  useEffect(() => { if (user) refresh(); }, [user?.id]);
  if (loading || !user) return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading…</div>;
  return (
    <div className="min-h-screen">
      <header className="glass sticky top-0 z-30 border-b">
        <div className="container mx-auto flex items-center justify-between px-4 py-3">
          <Link to="/dashboard" className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-md" style={{ background: "var(--gradient-primary)" }} />
            <span className="font-bold">POINT <span className="neon-text">ARENA</span></span>
          </Link>
          <nav className="hidden md:flex items-center gap-1 text-sm">
            <Link to="/dashboard" className="px-3 py-1.5 rounded hover:bg-muted">Dashboard</Link>
            <Link to="/create" className="px-3 py-1.5 rounded hover:bg-muted">Create</Link>
            <Link to="/my-tables" className="px-3 py-1.5 rounded hover:bg-muted">My Tables</Link>
            <Link to="/downloads" className="px-3 py-1.5 rounded hover:bg-muted">Downloads</Link>
            <Link to="/notifications" className="px-3 py-1.5 rounded hover:bg-muted">Inbox</Link>
            <Link to="/credits" className="px-3 py-1.5 rounded hover:bg-muted">Buy Credits</Link>
            <Link to="/profile" className="px-3 py-1.5 rounded hover:bg-muted">Profile</Link>
            {isAdmin && <Link to="/admin" className="px-3 py-1.5 rounded hover:bg-muted neon-text font-semibold">Admin</Link>}
          </nav>
          <div className="flex items-center gap-3">
            <span className="text-sm hidden sm:inline"><span className="neon-text font-bold">{profile?.credits ?? 0}</span> credits · max <b className="text-primary">{(profile?.max_resolution ?? "244p").toUpperCase()}</b></span>
            <Button variant="outline" size="sm" onClick={signOut}>Logout</Button>
          </div>
        </div>
      </header>
      <main className="container mx-auto px-4 py-8"><Outlet /></main>
    </div>
  );
}