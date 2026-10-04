"use client";
export default function ErrorPage({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <main className="site">
      <section className="card form-content" role="alert">
        <h1>Nepavyko įkelti puslapio</h1>
        <p>Įvyko laikina klaida. Bandykite dar kartą.</p>
        <button className="primary" onClick={retry}>
          Bandyti dar kartą
        </button>{" "}
        <a href="/">Grįžti į konkurso pradžią</a>
      </section>
    </main>
  );
}
