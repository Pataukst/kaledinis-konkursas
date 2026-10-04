import Link from "next/link";
export default function NotFound() {
  return (
    <main className="site">
      <section className="card form-content">
        <h1>Puslapis nerastas</h1>
        <p>Šio puslapio nėra arba jo adresas pasikeitė.</p>
        <Link href="/">Grįžti į konkurso pradžią</Link>
      </section>
    </main>
  );
}
