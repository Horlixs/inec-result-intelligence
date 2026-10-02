import { useEffect, useState } from "react";
import { AppShell } from "./AppShell";
import { AdminGate } from "./components/AdminGate";
import { ElectionDirectory } from "./components/ElectionDirectory";
import { ElectionProfile } from "./components/ElectionProfile";
import { RecentElections } from "./components/RecentElections";
import { ResultsReviewWorkspace } from "./components/ResultsReviewWorkspace";
import { AnalyticsWorkspace, CandidatesWorkspace, ResultsWorkspace } from "./components/WorkspacePages";

function Placeholder({ title }: { title: string }) {
  return <div className="rounded-3xl border border-zinc-800/60 bg-zinc-900/35 p-12 text-center"><p className="text-sm font-medium text-zinc-300">{title}</p><p className="mt-2 text-xs text-zinc-600">This workspace is ready for the corresponding evidence module.</p></div>;
}

function electionIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/elections\/([^/]+)\/results\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export default function App() {
  const [pathname, setPathname] = useState(() => window.location.pathname);
  useEffect(() => {
    const handlePopState = () => setPathname(window.location.pathname);
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);
  function navigate(to: string) {
    if (window.location.pathname !== to) window.history.pushState({}, "", to);
    setPathname(window.location.pathname);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
  const electionId = electionIdFromPath(pathname);
  let page;
  if (pathname === "/") page = <RecentElections onSelect={(id) => navigate("/elections/" + id + "/results")} />;
  else if (pathname === "/results") page = <ResultsWorkspace onSelectElection={(id) => navigate("/elections/" + id + "/results")} />;
  else if (pathname === "/candidates") page = <CandidatesWorkspace />;
  else if (pathname === "/analytics") page = <AnalyticsWorkspace />;
  else if (pathname === "/elections") page = <ElectionDirectory />;
  else if (electionId) page = <ElectionProfile selectedElectionId={electionId} detailOnly onElectionSelect={(id) => navigate("/elections/" + id + "/results")} onBackToElections={() => navigate("/elections")} />;
  else if (pathname === "/review" || pathname === "/view") page = <ResultsReviewWorkspace />;
  else if (pathname === "/evidence") page = <Placeholder title="Result evidence" />;
  else if (pathname === "/sources") page = <Placeholder title="Data sources" />;
  else page = <Placeholder title="Page not found" />;
  return <AdminGate><AppShell pathname={pathname} onNavigate={navigate}>{page}</AppShell></AdminGate>;
}
