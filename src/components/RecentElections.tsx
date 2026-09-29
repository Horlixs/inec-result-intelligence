import { ArrowUpRight, CalendarDays, LoaderCircle } from "lucide-react";
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

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase
      .from("elections")
      .select("id,name,election_type,election_date,status")
      .order("election_date", { ascending: false })
      .limit(3)
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

      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        {loading ? (
          <div className="col-span-full flex items-center justify-center py-10 text-zinc-600">
            <LoaderCircle size={18} className="animate-spin" />
          </div>
        ) : elections.length ? (
          elections.map((election) => (
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
