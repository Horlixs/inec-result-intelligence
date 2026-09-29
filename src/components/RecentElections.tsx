import { ArrowUpRight, CalendarDays, ChevronDown, Filter, LoaderCircle, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { supabase } from "../lib/supabase";

interface Election {
  id: string;
  name: string;
  election_type: string;
  election_date: string | null;
  status: string;
}

interface RecentElectionsProps {
  onSelect: (electionId: string) => void;
}

function humanElectionType(type: string): string {
  const labels: Record<string, string> = {
    presidential: "President",
    senatorial: "Senate",
    house_of_representatives: "House of Representatives",
    governorship: "Governor",
    house_of_assembly: "State House of Assembly",
    chairmanship: "Local Government Chairman",
    councillor: "Councillor",
  };
  return labels[type] ?? type.replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: string | null): string {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(value));
}

export function RecentElections({ onSelect }: RecentElectionsProps) {
  const [elections, setElections] = useState<Election[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [type, setType] = useState("all");

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase
      .from("elections")
      .select("id,name,election_type,election_date,status")
      .order("election_date", { ascending: false })
      .limit(100)
      .then((response) => {
        setElections((response.data ?? []) as Election[]);
        setLoading(false);
      });
  }, []);

  return (
    <section className="mt-6 rounded-2xl border border-zinc-800/60 bg-zinc-900/35 p-5 sm:p-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">Recent elections</p>
          <h2 className="mt-1 font-display text-xl font-semibold tracking-tight text-zinc-100">Latest election records</h2>
          <p className="mt-1 text-xs text-zinc-600">The three most recent elections in the intelligence database.</p>
        </div>
        <span className="hidden text-xs text-zinc-600 sm:block">View all in Elections</span>
      </div>

      <div className="mt-4 rounded-2xl border border-zinc-800/60 bg-zinc-950/45 p-3">
        <div className="flex flex-col gap-2.5 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600" />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search elections, constituencies or election types…" className="h-10 w-full rounded-xl border border-zinc-800 bg-zinc-900/70 pl-10 pr-9 text-xs text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-zinc-600" />
            {query && <button type="button" onClick={() => setQuery("")} className="absolute right-2.5 top-1/2 grid size-6 -translate-y-1/2 place-items-center rounded-lg text-zinc-600 hover:bg-zinc-800 hover:text-zinc-300"><X size={13} /></button>}
          </div>
          <label className="relative sm:w-44">
            <Filter size={13} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-600" />
            <select value={category} onChange={(e) => { setCategory(e.target.value); setType("all"); }} className="h-10 w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-900/70 pl-8 pr-8 text-xs text-zinc-300 outline-none focus:border-zinc-600">
              <option value="all">All categories</option><option value="Federal">Federal</option><option value="State">State</option><option value="Local Government">Local Government</option>
            </select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          </label>
          <label className="relative sm:w-52">
            <select value={type} onChange={(e) => setType(e.target.value)} className="h-10 w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-900/70 px-3 pr-8 text-xs text-zinc-300 outline-none focus:border-zinc-600">
              <option value="all">All election types</option>
              {typeOptions.map((value) => <option key={value} value={value}>{typeLabel(value)}</option>)}
            </select><ChevronDown size={13} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600" />
          </label>
          {hasFilters && <button type="button" onClick={() => { setQuery(""); setCategory("all"); setType("all"); }} className="h-10 rounded-xl border border-zinc-800 px-3.5 text-xs text-zinc-500 hover:bg-zinc-900 hover:text-zinc-200">Clear</button>}
        </div>
        <div className="mt-2 flex items-center justify-between px-1 text-[10px] uppercase tracking-[0.14em] text-zinc-700">
          <span>{hasFilters ? "Showing up to 3 matches" : "Latest 3 elections"}</span>
          <span>Search across the archive</span>
        </div>
      </div>

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full flex items-center justify-center py-10 text-zinc-600">
            <LoaderCircle size={18} className="animate-spin" />
          </div>
        ) : elections.length ? (
          filtered.map((election) => (
            <button
              key={election.id}
              type="button"
              onClick={() => onSelect(election.id)}
              className="group rounded-2xl border border-zinc-800/60 bg-zinc-950/35 p-4 text-left transition-all duration-200 ease-in-out hover:-translate-y-px hover:border-zinc-700 hover:bg-zinc-900/70"
            >
              <div className="flex items-start justify-between gap-3">
                <span className="rounded-full border border-zinc-800/60 px-2.5 py-1 text-[10px] font-medium text-zinc-500">
                  {election.status || "recorded"}
                </span>
                <ArrowUpRight size={15} className="text-zinc-700 transition-colors group-hover:text-zinc-300" />
              </div>
              <p className="mt-5 text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                {humanElectionType(election.election_type)}
              </p>
              <h3 className="mt-1 line-clamp-2 font-display text-sm font-semibold leading-5 text-zinc-200">
                {election.name}
              </h3>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-zinc-600">
                <CalendarDays size={13} />
                {formatDate(election.election_date)}
              </p>
            </button>
          ))
        ) : (
          <div className="col-span-full rounded-xl border border-dashed border-zinc-800/60 px-5 py-8 text-center text-xs text-zinc-600">
            No election records are available yet.
          </div>
        )}
      </div>
    </section>
  );
}
