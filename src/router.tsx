import { createRootRoute, createRoute, createRouter, Link, useNavigate, useParams } from "@tanstack/react-router";
import { AppShell } from "./AppShell";
import { ElectionDirectory } from "./components/ElectionDirectory";
import { ElectionProfile } from "./components/ElectionProfile";
import { RecentElections } from "./components/RecentElections";

function HomePage() {
  const navigate=useNavigate();
  return <><RecentElections onSelect={(id)=>navigate({to:"/elections/$electionId/results",params:{electionId:id}})}/></>;
}
function ElectionsPage(){ return <ElectionDirectory/>; }
function ElectionResultsPage(){ const {electionId}=useParams({from:"/elections/$electionId/results"}); const navigate=useNavigate(); return <div><div className="mb-5 flex flex-wrap items-center gap-2 text-xs"><Link to="/" className="text-zinc-600 hover:text-zinc-300">Home</Link><span className="text-zinc-800">/</span><Link to="/elections" className="text-zinc-600 hover:text-zinc-300">Elections</Link><span className="text-zinc-800">/</span><span className="text-zinc-300">Result</span></div><ElectionProfile selectedElectionId={electionId} detailOnly onElectionSelect={(id)=>{void navigate({to:"/elections/$electionId/results",params:{electionId:id}})}} onBackToElections={()=>{void navigate({to:"/elections"})}}/></div>; }
function Placeholder({title}:{title:string}){return <div className="rounded-3xl border border-zinc-800/60 bg-zinc-900/35 p-12 text-center"><p className="text-sm font-medium text-zinc-300">{title}</p><p className="mt-2 text-xs text-zinc-600">This workspace is ready for the corresponding evidence module.</p></div>}

const rootRoute=createRootRoute({component:()=> <AppShell/>,notFoundComponent:()=> <Placeholder title="Page not found"/>});
const indexRoute=createRoute({getParentRoute:()=>rootRoute,path:"/",component:HomePage});
const electionsRoute=createRoute({getParentRoute:()=>rootRoute,path:"/elections",component:ElectionsPage});
const resultsRoute=createRoute({getParentRoute:()=>rootRoute,path:"/elections/$electionId/results",component:ElectionResultsPage});
const evidenceRoute=createRoute({getParentRoute:()=>rootRoute,path:"/evidence",component:()=> <Placeholder title="Result evidence"/>});
const sourcesRoute=createRoute({getParentRoute:()=>rootRoute,path:"/sources",component:()=> <Placeholder title="Data sources"/>});
const routeTree=rootRoute.addChildren([indexRoute,electionsRoute,resultsRoute,evidenceRoute,sourcesRoute]);
export const router=createRouter({routeTree,defaultPreload:"intent",scrollRestoration:true});
declare module "@tanstack/react-router" { interface Register { router: typeof router } }
