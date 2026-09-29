import { CalendarDays, ChevronDown, ChevronRight, Layers3, Search, SlidersHorizontal, X } from "lucide-react";
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
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<"all" | Category>("all");
  const [typeFilter, setTypeFilter] = useState("all");

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

  const typeOptions = useMemo(() => {
    const types = rows
      .filter((election) => categoryFilter === "all" || categoryOf(election.election_type) === categoryFilter)
      .map((election) => election.election_type);

    return [...new Set(types)].sort((a, b) => typeLabel(a).localeCompare(typeLabel(b)));
  }, [rows, categoryFilter]);

  useEffect(() => {
    if (typeFilter !== "all" && !typeOptions.includes(typeFilter)) {
      setTypeFilter("all");
    }
  }, [typeFilter, typeOptions]);

  const filteredRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();

    return rows.filter((election) => {
      const category = categoryOf(election.election_type);
      const searchable = [
        election.name,
        election.election_type,
        typeLabel(election.election_type),
        category,
        election.status,
      ]
        .join(" ")
        .toLowerCase();

      return (
        (!normalizedQuery || searchable.includes(normalizedQuery)) &&
        (categoryFilter === "all" || category === categoryFilter) &&
        (typeFilter === "all" || election.election_type === typeFilter)
      );
    });
  }, [rows, query, categoryFilter, typeFilter]);

  const years = useMemo(() => {
    const grouped = new Map<string, Election[]>();

    for (const election of filteredRows) {
      const year = yearOf(election.election_date);
      grouped.set(year, [...(grouped.get(year) ?? []), election]);
    }

    return [...grouped.entries()].sort((a, b) => {
      if (a[0] === "Unknown") return 1;
      if (b[0] === "Unknown") return -1;
      return Number(b[0]) - Number(a[0]);
    });
  }, [filteredRows]);

  useEffect(() => {
    if (openYear && !years.some(([year]) => year === openYear)) {
      setOpenYear(null);
    }
  }, [openYear, years]);

  const hasFilters = query.trim() !== "" || categoryFilter !== "all" || typeFilter !== "all";

  function clearFilters() {
    setQuery("");
    setCategoryFilter("all");
    setTypeFilter("all");
  }

  if (loading) {
    return (
      <div className="rounded-3xl border border-zinc-800/60 bg-zinc-900/35 p-12 text-center text-sm text-zinc-500">
        Loading election archive…
      </div>
    );
  }

  return (
    <section>
      <div className="mb-7">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600">Election archive</p>
        <h2 className="mt-2 font-display text-3xl font-semibold tracking-tight text-zinc-100">
          Election years
        </h2>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-500">
          Select a year to explore every recorded election in that cycle. Search or filter the archive without leaving this workspace.
        </p>
      </div>

      <div className="mb-5 rounded-2xl border border-zinc-800/70 bg-zinc-950/55 p-3">
        <div className="flex flex-col gap-2.5 lg:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search
              size={16}
              className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600"
            />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search elections…"
              aria-label="Search elections"
              className="h-11 w-full rounded-xl border border-zinc-800 bg-zinc-900/70 pl-10 pr-10 text-sm text-zinc-200 outline-none placeholder:text-zinc-600 transition-colors focus:border-zinc-600 focus:bg-zinc-900"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-2.5 top-1/2 grid size-7 -translate-y-1/2 place-items-center rounded-lg text-zinc-600 transition-colors hover:bg-zinc-800 hover:text-zinc-300"
              >
                <X size={14} />
              </button>
            )}
          </div>

          <div className="flex flex-col gap-2.5 sm:flex-row">
            <label className="relative min-w-0 sm:w-48">
              <SlidersHorizontal
                size={14}
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-600"
              />
              <select
                value={categoryFilter}
                onChange={(event) => {
                  setCategoryFilter(event.target.value as "all" | Category);
                  setTypeFilter("all");
                }}
                aria-label="Filter by category"
                className="h-11 w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-900/70 pl-9 pr-8 text-xs font-medium text-zinc-300 outline-none transition-colors focus:border-zinc-600"
              >
                <option value="all">All categories</option>
                <option value="Federal">Federal</option>
                <option value="State">State</option>
                <option value="Local Government">Local Government</option>
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
              />
            </label>

            <label className="relative min-w-0 sm:w-56">
              <select
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                aria-label="Filter by election type"
                className="h-11 w-full appearance-none rounded-xl border border-zinc-800 bg-zinc-900/70 px-3.5 pr-8 text-xs font-medium text-zinc-300 outline-none transition-colors focus:border-zinc-600"
              >
                <option value="all">All election types</option>
                {typeOptions.map((type) => (
                  <option key={type} value={type}>
                    {typeLabel(type)}
                  </option>
                ))}
              </select>
              <ChevronDown
                size={14}
                className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-zinc-600"
              />
            </label>

            {hasFilters && (
              <button
                type="button"
                onClick={clearFilters}
                className="h-11 shrink-0 rounded-xl border border-zinc-800 px-4 text-xs font-medium text-zinc-500 transition-colors hover:border-zinc-700 hover:bg-zinc-900 hover:text-zinc-200"
              >
                Clear
              </button>
            )}
          </div>
        </div>

        <div className="mt-2.5 flex items-center justify-between px-1">
          <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-600">
            {hasFilters ? `${filteredRows.length} matching ${filteredRows.length === 1 ? "election" : "elections"}` : `${rows.length} recorded elections`}
          </span>
          {hasFilters && (
            <span className="text-[10px] text-zinc-700">
              {years.length} {years.length === 1 ? "year" : "years"} shown
            </span>
          )}
        </div>
      </div>

      {years.length === 0 ? (
        <div className="rounded-3xl border border-zinc-800/70 bg-zinc-950/45 px-6 py-16 text-center">
          <div className="mx-auto grid size-12 place-items-center rounded-2xl border border-zinc-800 bg-zinc-900 text-zinc-600">
            <Search size={18} />
          </div>
          <h3 className="mt-4 text-sm font-medium text-zinc-300">No elections found</h3>
          <p className="mx-auto mt-1.5 max-w-sm text-xs leading-5 text-zinc-600">
            Try a different search term or broaden your filters.
          </p>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="mt-4 rounded-xl border border-zinc-800 px-4 py-2 text-xs font-medium text-zinc-400 transition-colors hover:bg-zinc-900 hover:text-zinc-200"
            >
              Clear filters
            </button>
          )}
        </div>
      ) : (
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
      )}
    </section>
  );
}
