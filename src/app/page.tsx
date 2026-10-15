import Analyzer from "@/components/Analyzer";

export default function Home() {
  return (
    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Medical Document Fraud Check</h1>
        <p className="mt-2 max-w-3xl text-zinc-600 dark:text-zinc-400">
          Detect AI-generated, forged or tampered medical documents using Google Gemini plus automated
          file-metadata forensics.
        </p>
      </header>
      <Analyzer />
      <footer className="mt-12 text-xs text-zinc-500">
        Results are AI-assisted indicators, not proof. Always verify suspicious documents with the issuing
        provider before taking action. Uploaded files are sent to the Gemini API and are not stored by this app.
      </footer>
    </main>
  );
}
