"use client";
import { useEffect, useState } from "react";
import Confirmation from "./confirmation";
type Row = { id: string; code: string; title: string; status: string };
type Preview = {
  total: number;
  rows: { code: string; title: string; line: number }[];
  errors: { line: number; message: string }[];
};
const statuses: Record<string, string> = {
  available: "Laisva",
  allocated: "Paskirta",
  archived: "Pašalinta",
};
export default function Admin() {
  const [logged, setLogged] = useState(false),
    [busy, setBusy] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [rows, setRows] = useState<Row[]>([]),
    [counts, setCounts] = useState<Record<string, number>>({}),
    [q, setQ] = useState(""),
    [status, setStatus] = useState(""),
    [page, setPage] = useState(1),
    [total, setTotal] = useState(0),
    [selected, setSelected] = useState<string[]>([]),
    [csv, setCsv] = useState(""),
    [preview, setPreview] = useState<Preview | null>(null),
    [confirm, setConfirm] = useState<"import" | "archive" | null>(null);
  async function load() {
    const r = await fetch(
      `/api/admin?q=${encodeURIComponent(q)}&status=${status}&page=${page}`,
      { cache: "no-store" },
    );
    const d = await r.json();
    if (r.status === 401) {
      setLogged(false);
      return;
    }
    if (!r.ok) throw new Error(d.error);
    setLogged(true);
    setRows(d.rows);
    setCounts(d.counts);
    setTotal(d.total);
    setSelected([]);
  }
  useEffect(() => {
    void load().catch((e) => setError(e.message));
  }, [page, status]);
  async function action(body: unknown) {
    const r = await fetch("/api/admin", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const d = await r.json();
    if (r.status === 401) setLogged(false);
    if (!r.ok) throw new Error(d.error);
    return d;
  }
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="admin">
      <header>
        <a href="/">← Konkursas</a>
        <h1>Dovanų administravimas</h1>
        {logged && (
          <button
            onClick={() =>
              run(async () => {
                await action({ action: "logout" });
                setLogged(false);
              })
            }
          >
            Atsijungti
          </button>
        )}
      </header>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p role="status" className="success">
          {message}
        </p>
      )}
      {!logged ? (
        <form
          noValidate
          className="login card"
          onSubmit={(e) => {
            e.preventDefault();
            void run(async () => {
              await action({ action: "login", username, password });
              setPassword("");
              await load();
            });
          }}
        >
          <h2>Prisijungimas</h2>
          <div className="field">
            <label htmlFor="username">Administratoriaus vardas</label>
            <input
              id="username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label htmlFor="password">Slaptažodis</label>
            <input
              id="password"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>
          <button className="primary" disabled={busy}>
            {busy ? "Jungiama…" : "Prisijungti"}
          </button>
        </form>
      ) : (
        <>
          <div className="counts">
            {Object.entries(statuses).map(([key, title]) => (
              <div key={key}>
                <strong>{counts[key] || 0}</strong>
                <span>{title}</span>
              </div>
            ))}
          </div>
          <section className="admin-panel">
            <h2>Dovanų sąrašas</h2>
            <form
              className="toolbar"
              onSubmit={(e) => {
                e.preventDefault();
                void run(load);
              }}
            >
              <label>
                Paieška
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Kodas arba pavadinimas"
                />
              </label>
              <label>
                Būsena
                <select
                  value={status}
                  onChange={(e) => {
                    setStatus(e.target.value);
                    setPage(1);
                  }}
                >
                  <option value="">Visos</option>
                  {Object.entries(statuses).map(([s, t]) => (
                    <option key={s} value={s}>
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <button disabled={busy}>Ieškoti</button>
            </form>
            <p>
              „Pašalinti“ archyvuoja nepanaudotus kodus. Paskirtų kodų pašalinti
              negalima.
            </p>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>
                      <input
                        type="checkbox"
                        aria-label="Pasirinkti visas laisvas šio puslapio dovanas"
                        checked={
                          rows.some((r) => r.status === "available") &&
                          selected.length ===
                            rows.filter((r) => r.status === "available").length
                        }
                        onChange={(e) =>
                          setSelected(
                            e.target.checked
                              ? rows
                                  .filter((r) => r.status === "available")
                                  .map((r) => r.id)
                              : [],
                          )
                        }
                      />
                    </th>
                    <th>Dovanos kodas</th>
                    <th>Dovanos pavadinimas</th>
                    <th>Būsena</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <input
                          type="checkbox"
                          aria-label={`Pasirinkti kodą ${r.code}`}
                          disabled={r.status !== "available" || busy}
                          checked={selected.includes(r.id)}
                          onChange={(e) =>
                            setSelected((s) =>
                              e.target.checked
                                ? [...s, r.id]
                                : s.filter((id) => id !== r.id),
                            )
                          }
                        />
                      </td>
                      <td>
                        <code>{r.code}</code>
                      </td>
                      <td>{r.title}</td>
                      <td>
                        <span className={`badge ${r.status}`}>
                          {statuses[r.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!rows.length && <p>Dovanų nerasta.</p>}
            <div className="toolbar">
              <button
                disabled={!selected.length || busy}
                onClick={() => setConfirm("archive")}
              >
                Pašalinti pasirinktas ({selected.length})
              </button>
              <button
                disabled={page <= 1 || busy}
                onClick={() => setPage((p) => p - 1)}
              >
                Ankstesnis
              </button>
              <span>
                {page} / {Math.max(1, Math.ceil(total / 20))}
              </span>
              <button
                disabled={page * 20 >= total || busy}
                onClick={() => setPage((p) => p + 1)}
              >
                Kitas
              </button>
            </div>
          </section>
          <section className="admin-panel">
            <h2>CSV importas</h2>
            <p>
              Kodai ir pavadinimai importuojami kartu, tik patvirtinus visas
              tinkamas eilutes.
            </p>
            <a href="/dovanu-sablonas.csv" download>
              Atsisiųsti CSV šabloną
            </a>
            <div className="field">
              <label htmlFor="csv">CSV failas (UTF-8)</label>
              <input
                id="csv"
                type="file"
                accept=".csv,text/csv"
                disabled={busy}
                onChange={(e) => {
                  setPreview(null);
                  setConfirm(null);
                  const file = e.target.files?.[0];
                  if (file)
                    void run(async () => {
                      if (file.size > 10485760)
                        throw new Error("Failas per didelis.");
                      const text = await file.text();
                      setCsv(text);
                      setPreview(
                        await action({ action: "preview", csv: text }),
                      );
                    });
                }}
              />
            </div>
            {preview && (
              <>
                <p>
                  Iš viso: {preview.total}. Klaidos: {preview.errors.length}.
                </p>
                {preview.errors.map((r, i) => (
                  <p key={i} className="field-error">
                    {r.line} eilutė: {r.message}
                  </p>
                ))}
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Eilutė</th>
                        <th>Kodas</th>
                        <th>Pavadinimas</th>
                      </tr>
                    </thead>
                    <tbody>
                      {preview.rows.slice(0, 100).map((r, i) => (
                        <tr key={i}>
                          <td>{r.line}</td>
                          <td>{r.code}</td>
                          <td>{r.title}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.rows.length > 100 && (
                  <p>
                    Rodoma pirmų 100 eilučių peržiūra. Patikrintas visas failas.
                  </p>
                )}
                <button
                  className="primary"
                  disabled={busy || preview.errors.length > 0}
                  onClick={() => setConfirm("import")}
                >
                  Importuoti {preview.total} dovanų
                </button>
              </>
            )}
          </section>
          {confirm && (
            <Confirmation busy={busy} onClose={() => setConfirm(null)}>
              <h2 id="confirm-title">
                {confirm === "import"
                  ? `Importuoti ${preview?.total} dovanų?`
                  : `Pašalinti ${selected.length} pasirinktų dovanų?`}
              </h2>
              <p>
                {confirm === "archive"
                  ? "Paskirtos dovanos bus apsaugotos. Nepanaudoti kodai bus pašalinti iš aktyvaus sąrašo."
                  : "Visos eilutės bus įrašytos vienu veiksmu."}
              </p>
              <button
                autoFocus
                disabled={busy}
                onClick={() => setConfirm(null)}
              >
                Atšaukti
              </button>
              <button
                className="primary"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    const d = await action(
                      confirm === "import"
                        ? { action: "import", csv, confirm: true }
                        : { action: "archive", ids: selected, confirm: true },
                    );
                    setMessage(
                      confirm === "import"
                        ? `Importuota: ${d.imported}.`
                        : `Pašalinta: ${d.removed}. Apsaugota arba praleista: ${d.skipped}.`,
                    );
                    setConfirm(null);
                    setPreview(null);
                    await load();
                  })
                }
              >
                Patvirtinti
              </button>
            </Confirmation>
          )}
        </>
      )}
    </main>
  );
}
