import Analyzer from "@/components/Analyzer";

const FEATURES = ["AI-generation detection", "Tamper detection", "Medical plausibility", "File forensics"];

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-16 sm:px-6">
      <section className="py-10 sm:py-14">
        <span className="inline-flex items-center rounded-full border border-line bg-card px-3 py-1 text-xs font-medium text-ink-2">
          Healthcare & insurance fraud screening
        </span>
        <h1 className="mt-4 max-w-3xl text-3xl font-semibold tracking-tight text-ink sm:text-4xl">
          Spot forged and AI-generated medical documents in seconds
        </h1>
        <p className="mt-3 max-w-2xl text-ink-2">
          Upload a prescription, lab report, discharge summary or bill to get a risk verdict with the evidence behind it.
        </p>
        <ul className="mt-5 flex flex-wrap gap-2">
          {FEATURES.map((f) => (
            <li key={f} className="rounded-full bg-accent-soft px-3 py-1 text-xs font-medium text-ink">
              {f}
            </li>
          ))}
        </ul>
      </section>
      <Analyzer />
    </main>
  );
}
