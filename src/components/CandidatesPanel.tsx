import { ExternalLink, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { supabase } from "../lib/supabase";

interface Props { electionId: string; sourceUrl?: string | null; }
interface Candidate { id: string; name: string; party_id: string | null; ballot_order: number | null; }
interface RecordRow { candidate_id: string | null; full_name: string; party_id: string | null; ballot_order: number | null; photo_url?: string | null; position?: string | null; status?: string; }
interface Party { id: string; abbreviation: string; name: string | null; }

export function CandidatesPanel({ electionId, sourceUrl }: Props) {
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [records, setRecords] = useState<RecordRow[]>([]);
  const [parties, setParties] = useState<Party[]>([]);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!supabase || !electionId) return;
    let cancelled = false;
    setLoading(true);
    void Promise.all([
      supabase.from("candidates").select("id,name,party_id,ballot_order").eq("election_id", electionId).order("ballot_order", {ascending:true,nullsFirst:false}).order("name"),
      supabase.from("candidate_records").select("candidate_id,full_name,party_id,ballot_order,photo_url,position,status").eq("election_id", electionId).eq("status","published").is("valid_to",null).order("ballot_order",{ascending:true,nullsFirst:false}).order("full_name"),
      supabase.from("parties").select("id,abbreviation,name").order("abbreviation"),
    ]).then(([candidateRes, recordRes, partyRes]) => {
      if (cancelled) return;
      if (candidateRes.error) setNotice(candidateRes.error.message);
      if (recordRes.error && !/does not exist|relation/i.test(recordRes.error.message)) setNotice(recordRes.error.message);
      if (partyRes.error) setNotice(partyRes.error.message);
      setCandidates((candidateRes.data ?? []) as Candidate[]);
      setRecords((recordRes.data ?? []) as RecordRow[]);
      setParties((partyRes.data ?? []) as Party[]);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [electionId]);

  const partyMap = useMemo(() => new Map(parties.map((p) => [p.id,p])), [parties]);
  const merged = useMemo(() => {
    const byId = new Map<string, RecordRow>();
    for (const r of records) if (r.candidate_id) byId.set(r.candidate_id, r);
    const rows = candidates.map((c) => {
      const r = byId.get(c.id);
      return { id:c.id, name:r?.full_name ?? c.name, partyId:r?.party_id ?? c.party_id, ballot:r?.ballot_order ?? c.ballot_order, photo:r?.photo_url ?? null, position:r?.position ?? null };
    });
    for (const r of records.filter((x) => !x.candidate_id)) rows.push({ id:"record-"+r.full_name, name:r.full_name, partyId:r.party_id, ballot:r.ballot_order, photo:r.photo_url ?? null, position:r.position ?? null });
    return rows.sort((a,b)=>(a.ballot??9999)-(b.ballot??9999)||a.name.localeCompare(b.name));
  }, [candidates,records]);

  return <div className="mt-5 rounded-2xl border border-zinc-800/60 bg-zinc-900/40 p-5 sm:p-6">
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><p className="text-[10px] font-semibold uppercase tracking-[.16em] text-zinc-600">Official contest metadata</p><h3 className="mt-2 font-display text-xl font-semibold text-zinc-100">Candidates & parties</h3><p className="mt-1 text-xs leading-5 text-zinc-600">Names and party affiliations are displayed from synchronized INEC candidate records when available; OCR labels are not used to invent candidate identities.</p></div>
      {sourceUrl && <a href={sourceUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-xs text-zinc-400 hover:text-white">INEC source <ExternalLink size={13}/></a>}
    </div>
    {notice && <div className="mt-4 rounded-xl border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-200">Candidate metadata notice: {notice}</div>}
    {loading ? <div className="mt-5 h-32 animate-pulse rounded-xl bg-zinc-800/40"/> : merged.length ? <div className="mt-5 overflow-hidden rounded-xl border border-zinc-800/60">
      <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(80px,.4fr)_auto] gap-3 bg-zinc-950/60 px-4 py-3 text-[10px] font-semibold uppercase tracking-[.12em] text-zinc-600"><span>#</span><span>Candidate</span><span>Party</span><span className="text-right">Status</span></div>
      {merged.map((c)=><div key={c.id} className="grid grid-cols-[auto_minmax(0,1fr)_minmax(80px,.4fr)_auto] items-center gap-3 border-t border-zinc-800/50 px-4 py-3.5">
        <span className="w-7 text-xs text-zinc-600">{c.ballot ?? "—"}</span>
        <div className="min-w-0"><p className="truncate text-sm font-medium text-zinc-200">{c.name}</p>{c.position && <p className="text-[10px] text-zinc-600">{c.position}</p>}</div>
        <div className="min-w-0"><p className="truncate text-xs font-semibold text-zinc-300">{c.partyId ? partyMap.get(c.partyId)?.abbreviation ?? "—" : "—"}</p><p className="truncate text-[10px] text-zinc-600">{c.partyId ? partyMap.get(c.partyId)?.name ?? "" : ""}</p></div>
        <span className="text-[10px] text-right text-zinc-500">Published</span>
      </div>)}
    </div> : <div className="mt-5 rounded-xl border border-dashed border-zinc-800/60 p-8 text-center"><Users className="mx-auto text-zinc-700" size={24}/><p className="mt-3 text-sm text-zinc-400">No synchronized candidate records yet.</p><p className="mt-1 text-xs text-zinc-600">The database schema retains candidate and party identity separately from OCR result labels, so this can be populated from official INEC candidate publications without changing result extraction.</p></div>}
  </div>;
}
