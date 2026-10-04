"use client";
export default function GlobalError({
  retry,
}: {
  error: Error & { digest?: string };
  retry: () => void;
}) {
  return (
    <html lang="lt">
      <body>
        <main role="alert">
          <h1>Nepavyko įkelti svetainės</h1>
          <p>Įvyko laikina klaida. Bandykite dar kartą.</p>
          <button onClick={retry}>Bandyti dar kartą</button>{" "}
          <a href="/">Grįžti į konkurso pradžią</a>
        </main>
      </body>
    </html>
  );
}
