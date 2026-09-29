import { CalendarDays, ChevronDown, ChevronRight, Layers3 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

interface Election {
  id: string;
  name: string;
  election_type: string;
  election_date: string | null;
  status: string;
}

type Category = "Federal" | "State" | "Local Government";

function yearOf(value: string | null): string {
  return value ? new Date(value).getFullYear().toString() : "Unknown";
}

function categoryOf(type: string): Category {
  if (["presidential", "senatorial", "house_of_representatives"].includes(type)) return "Federal";
  if (["governorship", "house_of_assembly", "state_constituency"].includes(type)) return "State";
  return "Local Government";
}

function typeLabel(type: string): string {
  const labels: Record<string, string> = {
    presidential: "Presidential",
    senatorial: "Senate",
    house_of_representatives: "House of Representatives",
    governorship: "Governorship",
    house_of_assembly: "State House of Assembly",
    state_constituency: "State Constituency",
    chairmanship: "Chairmanship",
    councillor: "Councillor",
  };
  return labels[type] ?? type.replace(/_/g, " ");
}

function dateLabel(value: string | null): string {
  return value
    ? new Intl.DateTimeFormat("en-NG", { dateStyle: "medium" }).format(new Date(value))
    : "Date unavailable";
}

export function ElectionDirectory() {
  const [rows, setRows] = useState<Election[]>([]);
  const [loading, setLoading] = useState(true);
  const [openYear, setOpenYear] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) {
      setLoading(false);
      return;
    }

    void supabase
      .from("elections")
      .select("id,name,election_type,election_date,status")
      .order("election_date", { ascending: false })
      .then((response) => {
        setRows((response.data ?? []) as Election[]);
        setLoading(false);
      });
  }, []);

  const years = useMemo(() => {
    const grouped = new Map<string, Election[]>();

    for (const election of rows) {
      const year = yearOf(election.election_date);
      grouped.set(year, [...(grouped.get(year) ?? []), election]);
    }

    return [...grouped.entries()].sort((a, b) => Number(b[0]) - Number(a[0]));
  }, [rows]);

  if (loading) {
    return (
      <div className="rounded-3xl border border-zinc-800/60 bg-zinc-900/35 p-12 text-center text-sm text-zinc-500">
        Loading election archive…
      </div>
    );
  }

  return (
    <section>
      <div className="mb-8">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Election archive</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-zinc-100">
          Election years
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
          Select a year to explore every recorded election in that cycle. Only one year stays open at a time.
        </p>
      </div>

      <div className="overflow-hidden rounded-3xl border border-zinc-800/70 bg-zinc-950/45">
        {years.map(([year, elections], index) => {
          const isOpen = openYear === year;
          const categories = (["Federal", "State", "Local Government"] as Category[])
            .map((category) => ({
              category,
              count: elections.filter((election) => categoryOf(election.election_type) === category).length,
            }))
            .filter((item) => item.count > 0);

          return (
            <div
              key={year}
              className={index > 0 ? "border-t border-zinc-800/70" : ""}
            >
              <button
                type="button"
                onClick={() => setOpenYear(isOpen ? null : year)}
                aria-expanded={isOpen}
                className="group flex w-full items-center gap-4 px-5 py-5 text-left transition-colors hover:bg-zinc-900/70 sm:px-7 sm:py-6"
              >
                <div className="grid size-14 shrink-0 place-items-center rounded-2xl border border-zinc-700/60 bg-zinc-900 font-display text-lg font-semibold text-zinc-100">
                  {year}
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h3 className="font-display text-xl font-semibold text-zinc-100">{year} elections</h3>
                    <span className="rounded-full border border-zinc-800 bg-zinc-900 px-2.5 py-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                      {elections.length} {elections.length === 1 ? "election" : "elections"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {categories.map(({ category, count }) => (
                      <span key={category} className="text-[11px] text-zinc-600">
                        {category} · {count}
                      </span>
                    ))}
                  </div>
                </div>

                <ChevronDown
                  size={20}
                  className={"shrink-0 text-zinc-600 transition-transform duration-300 " + (isOpen ? "rotate-180" : "")}
                />
              </button>

              <div
                className="grid transition-[grid-template-rows] duration-300 ease-out"
                style={{ gridTemplateRows: isOpen ? "1fr" : "0fr" }}
              >
                <div className="min-h-0 overflow-hidden">
                  <div className="border-t border-zinc-800/50 bg-[#080a0e] px-4 pb-5 pt-4 sm:px-7 sm:pb-7">
                    <div className="mb-4 flex items-center justify-between">
                      <div>
                        <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-zinc-600">
                          {year} election cycle
                        </p>
                        <p className="mt-1 text-xs text-zinc-500">
                          Browse across federal, state and local-government contests.
                        </p>
                      </div>
                      <span className="hidden text-[11px] text-zinc-600 sm:block">
                        {elections.length} records
                      </span>
                    </div>

                    <div className="space-y-2">
                      {elections.map((election) => (
                        <a
                          key={election.id}
                          href={"/elections/" + election.id + "/results"}
                          className="group flex items-center gap-4 rounded-2xl border border-zinc-800/60 bg-zinc-900/35 px-4 py-4 transition-all hover:border-zinc-700 hover:bg-zinc-900/70"
                        >
                          <div className="hidden size-9 shrink-0 place-items-center rounded-xl bg-zinc-950 text-zinc-600 sm:grid">
                            <Layers3 size={15} />
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-600">
                                {categoryOf(election.election_type)}
                              </span>
                              <span className="text-[10px] text-zinc-700">•</span>
                              <span className="text-[10px] uppercase tracking-[0.12em] text-zinc-600">
                                {typeLabel(election.election_type)}
                              </span>
                            </div>
                            <p className="mt-1 truncate text-sm font-medium text-zinc-200">
                              {election.name}
                            </p>
                            <div className="mt-1 flex items-center gap-1.5 text-[10px] text-zinc-600">
                              <CalendarDays size={12} />
                              {dateLabel(election.election_date)}
                            </div>
                          </div>

                          <ChevronRight
                            size={17}
                            className="shrink-0 text-zinc-700 transition-transform group-hover:translate-x-1 group-hover:text-zinc-400"
                          />
                        </a>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

