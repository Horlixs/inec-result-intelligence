import { BarChart3, CheckCircle2, Database, FileImage, Search, ShieldCheck, UploadCloud } from "lucide-react";

const pipeline = [
  { label: "Sources", value: "IReV / INEC", icon: Database },
  { label: "Evidence", value: "Original sheets", icon: FileImage },
  { label: "Extraction", value: "OCR + vision", icon: Search },
  { label: "Validation", value: "Deterministic checks", icon: ShieldCheck },
  { label: "Analytics", value: "Aggregated results", icon: BarChart3 },
];

const checks = [
  "Candidate totals reconciled against polling-unit figures",
  "Duplicate source sheets detected before aggregation",
  "Every displayed figure retains a source-sheet reference",
];

export default function App() {
  return (
    <main className="shell">
      <nav className="nav">
        <div className="brand">
          <div className="brand-mark">IR</div>
          <div>
            <strong>INEC Result Intelligence</strong>
            <span>Evidence-first election data</span>
          </div>
        </div>
        <div className="status"><span className="dot" /> Foundation ready</div>
      </nav>

      <section className="hero">
        <div className="eyebrow">CIVIC DATA · SOURCE TRACEABILITY · ANALYTICS</div>
        <h1>From result sheet<br /><em>to verified insight.</em></h1>
        <p className="lead">
          A transparent pipeline for extracting polling-unit results from public INEC sources,
          validating the data, and turning it into traceable analytics.
        </p>
        <div className="actions">
          <button className="primary"><UploadCloud size={18} /> Start ingestion</button>
          <button className="secondary">Explore architecture</button>
        </div>
      </section>

      <section className="pipeline">
        {pipeline.map(({ label, value, icon: Icon }, index) => (
          <div className="pipeline-card" key={label}>
            <div className="step">{String(index + 1).padStart(2, "0")}</div>
            <Icon size={19} strokeWidth={1.8} />
            <span>{label}</span>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      <section className="lower">
        <div className="panel">
          <div className="panel-label">DATA INTEGRITY</div>
          <h2>Evidence stays attached to the number.</h2>
          <p>
            The platform will preserve original result-sheet evidence alongside extracted values,
            validation outcomes, corrections, and processing metadata.
          </p>
          <div className="checks">
            {checks.map((check) => (
              <div className="check" key={check}><CheckCircle2 size={17} />{check}</div>
            ))}
          </div>
        </div>
        <div className="panel accent">
          <div className="panel-label">NEXT MILESTONE</div>
          <h2>Connect the real source.</h2>
          <p>
            Before building a collector, we will inspect the current public INEC result flow and
            document the source contract rather than assuming an undocumented API.
          </p>
          <div className="source-pill"><span className="dot" /> Source discovery pending</div>
        </div>
      </section>
    </main>
  );
}
