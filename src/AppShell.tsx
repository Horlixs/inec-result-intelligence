import { Activity, BarChart3, Database, FileCheck2, LayoutDashboard, Menu, RefreshCw, Settings2, ShieldCheck, Sparkles, Users, X } from "lucide-react";
import { useState } from "react";
import { PipelineRunner } from "./components/PipelineRunner";
import { SystemValidator } from "./components/SystemValidator";
import { portalSignOut } from "./lib/supabase";

const navigation = [
  { label: "Overview", to: "/" , icon: LayoutDashboard },
  { label: "Elections", to: "/elections", icon: BarChart3 },
  { label: "Results", to: "/results", icon: ShieldCheck },
  { label: "Candidates", to: "/candidates", icon: Users },
  { label: "Analytics", to: "/analytics", icon: Activity },
  { label: "Review results", to: "/view", icon: FileCheck2 },
  { label: "Data sources", to: "/sources", icon: Database },
];

interface AppShellProps {
  pathname: string;
  onNavigate: (to: string) => void;
  children: any;
}

export function AppShell({ pathname, onNavigate, children }: AppShellProps) {
  const [mobileOpen, setMobileOpen] = useState(false);
  return <div className="min-h-screen bg-[#07090d] text-zinc-100">
    <div className="flex min-h-screen">
      <aside className={"fixed inset-y-0 left-0 z-50 w-[17rem] border-r border-zinc-800/60 bg-[#090b10]/95 p-4 backdrop-blur-xl transition-transform duration-200 lg:static lg:translate-x-0 " + (mobileOpen ? "translate-x-0" : "-translate-x-full")}>
        <div className="flex h-full flex-col">
          <div className="flex items-center justify-between px-2 py-2">
            <a href="/" onClick={(event) => { event.preventDefault(); onNavigate("/"); setMobileOpen(false); }} className="flex items-center gap-3">
              <div className="grid size-10 place-items-center rounded-xl bg-zinc-100 text-sm font-bold text-zinc-950 shadow-lg shadow-black/20">IR</div>
              <div><p className="font-display text-sm font-semibold tracking-tight">INEC Intelligence</p><p className="text-xs text-zinc-500">Evidence-first data</p></div>
            </a>
            <button aria-label="Close navigation" onClick={() => setMobileOpen(false)} className="rounded-lg p-2 text-zinc-500 hover:bg-zinc-800 hover:text-zinc-200 lg:hidden"><X size={18}/></button>
          </div>
          <nav className="mt-8 space-y-1">
            <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Workspace</p>
            {navigation.map(({label,to,icon:Icon}) => {
              const active = to === "/" ? pathname === "/" : pathname.startsWith(to);
              return <a key={label} href={to} onClick={(event) => { event.preventDefault(); onNavigate(to); setMobileOpen(false); }} className={"flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-all hover:translate-y-[-1px] " + (active ? "bg-zinc-800/80 text-zinc-100 shadow-sm" : "text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200")}><Icon size={17} strokeWidth={1.8}/>{label}</a>;
            })}
          </nav>
          <div className="mt-auto space-y-1">
            <div className="mb-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/60 p-4"><div className="flex items-center gap-2 text-xs font-medium text-zinc-300"><Sparkles size={14}/> Intelligence layer</div><p className="mt-2 text-xs leading-5 text-zinc-500">Official-source discovery, extraction and validation in one workspace.</p></div>
            <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"><Settings2 size={17}/> Settings</button>
            <button type="button" onClick={() => void portalSignOut()} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200"><ShieldCheck size={17}/> Sign out</button>
          </div>
        </div>
      </aside>
      {mobileOpen && <button aria-label="Close navigation overlay" onClick={() => setMobileOpen(false)} className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"/>}
      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-zinc-800/60 bg-[#07090d]/80 backdrop-blur-xl"><div className="flex h-14 items-center justify-between px-4 sm:px-6 lg:px-8"><div className="flex items-center gap-3"><button aria-label="Open navigation" onClick={() => setMobileOpen(true)} className="rounded-xl border border-zinc-800/60 p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100 lg:hidden"><Menu size={18}/></button><div className="hidden items-center gap-2 rounded-xl border border-zinc-800/60 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-500 sm:flex">Election intelligence</div></div><div className="flex items-center gap-2"><span className="hidden items-center gap-2 rounded-full border border-emerald-500/20 bg-emerald-500/5 px-3 py-1.5 text-xs text-emerald-300 sm:flex"><span className="size-1.5 rounded-full bg-emerald-400"/> Sources online</span><button aria-label="Refresh workspace" className="rounded-xl border border-zinc-800/60 p-2 text-zinc-400 hover:bg-zinc-900 hover:text-zinc-100"><RefreshCw size={17}/></button></div></div></header>
        <main className="mx-auto max-w-[1500px] p-4 sm:p-6 lg:p-8">
          <section className="mb-7 overflow-hidden rounded-3xl border border-zinc-800/60 bg-gradient-to-br from-zinc-900/80 via-zinc-900/40 to-zinc-950/70 px-5 py-6 shadow-2xl shadow-black/10 sm:px-7 sm:py-7"><div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end"><div className="max-w-3xl"><div className="mb-4 inline-flex items-center gap-2 rounded-full border border-zinc-800/60 bg-zinc-950/70 px-3 py-1.5 text-[11px] font-medium text-zinc-400"><Activity size={13}/> Election intelligence workspace</div><h1 className="font-display text-[2rem] font-semibold leading-[1.08] tracking-[-0.035em] text-zinc-50 sm:text-[2.35rem]">Know what the result data says.</h1><p className="mt-4 max-w-2xl text-[13px] leading-6 text-zinc-500 sm:text-sm">Trace official election metadata, result evidence and validation signals from source to insight.</p></div><div className="flex items-center gap-3 rounded-2xl border border-zinc-800/60 bg-zinc-950/50 px-4 py-3"><div className="grid size-9 place-items-center rounded-xl bg-zinc-800/80 text-zinc-300"><ShieldCheck size={17}/></div><div><p className="text-xs font-medium text-zinc-300">Evidence-first</p><p className="text-xs text-zinc-600">Source attached to every signal</p></div></div></div></section>
          {children}
        </main>
      </div>
    </div>
    <PipelineRunner/><SystemValidator/>
  </div>;
}
