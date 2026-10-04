"use client";
import { useEffect, useState } from "react";
import {
  claimSchema,
  labels,
  purchaseSchema,
  vilniusDate,
} from "@/lib/validation";
import { demoNotice } from "@/lib/config";
type Channel = keyof typeof labels;
type Result = { id: string; email: string; delayed: boolean };
export default function Contest({
  organiser,
  rulesUrl,
  privacyUrl,
}: {
  organiser: string;
  rulesUrl: string;
  privacyUrl: string;
}) {
  const [step, setStep] = useState(1),
    [channel, setChannel] = useState<Channel | "">(""),
    [values, setValues] = useState<Record<string, string>>({}),
    [box, setBox] = useState(0),
    [email, setEmail] = useState(""),
    [consent, setConsent] = useState(false),
    [busy, setBusy] = useState(true),
    [error, setError] = useState(""),
    [fields, setFields] = useState<Record<string, string>>({}),
    [result, setResult] = useState<Result | null>(null),
    [requestKey, setRequestKey] = useState(""),
    [settings, setSettings] = useState({
      mock: false,
      allowed: false,
      maxLength: 128,
      consent: { text: "", version: "" },
    });
  async function api(action: string, input?: unknown) {
    const r = await fetch("/api/contest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });
    const data = await r.json();
    if (!r.ok) {
      setFields(data.fields || {});
      throw new Error(data.error);
    }
    return data;
  }
  async function load() {
    try {
      const r = await fetch("/api/contest", { cache: "no-store" });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error);
      setSettings(d);
      if (d.claim) {
        setResult(d.claim);
        setStep(4);
      } else if (d.eligible) {
        setChannel(d.channel);
        setStep(3);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    setRequestKey(sessionStorage.getItem("claimKey") || crypto.randomUUID());
    void load();
  }, []);
  useEffect(() => {
    document.getElementById("step-title")?.focus();
  }, [step]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setFields({});
    try {
      await fn();
    } catch (e) {
      setError((e as Error).message || "Bandykite vėliau.");
    } finally {
      setBusy(false);
    }
  }
  async function next() {
    if (step === 1) {
      if (!channel) {
        setError("Pasirinkite, kur įsigijote dovaną.");
        return;
      }
      setStep(2);
      return;
    }
    await run(async () => {
      const input = { channel, ...values };
      const p = purchaseSchema(settings.maxLength).safeParse(input);
      if (!p.success) {
        setFields(
          Object.fromEntries(
            p.error.issues.map((i) => [String(i.path[0]), i.message]),
          ),
        );
        return;
      }
      await api("validate", p.data);
      setStep(3);
    });
  }
  async function back() {
    await run(async () => {
      await api("invalidate");
      setBox(0);
      setConsent(false);
      setFields({});
      setStep(step === 3 ? 2 : 1);
    });
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    await run(async () => {
      const input = {
        email,
        box,
        consent,
        consentVersion: settings.consent.version,
        consentText: settings.consent.text,
        requestKey,
      };
      const p = claimSchema.safeParse(input);
      if (!p.success) {
        setFields(
          Object.fromEntries(
            p.error.issues.map((i) => [String(i.path[0]), i.message]),
          ),
        );
        return;
      }
      sessionStorage.setItem("claimKey", requestKey);
      const d = await api("claim", p.data);
      setResult(d);
      setStep(4);
    });
  }
  return (
    <main className="site">
      <div className="stars" aria-hidden="true">
        ✦ · ✧ · ✦
      </div>
      <header className="brand">
        <span aria-hidden="true">✧</span> Kalėdų staigmena
      </header>
      {settings.mock && <aside className="demo">{demoNotice}</aside>}
      <div className="intro">
        <p className="eyebrow">ŠIEK TIEK KALĖDŲ MAGIJOS</p>
        <h1>
          Jūsų dovana.
          <br />
          <em>Mūsų kalėdinė staigmena.</em>
        </h1>
        <p>Įsigijote dovaną? Pakvieskite šventinį džiaugsmą ir į savo namus.</p>
      </div>
      <section className="card" aria-label="Dalyvavimas konkurse">
        <ol className="progress" aria-label="Keturi dalyvavimo žingsniai">
          {["Pirkimo vieta", "Pirkimo duomenys", "Jūsų dovana", "Ačiū"].map(
            (s, i) => (
              <li
                key={s}
                className={step >= i + 1 ? "active" : ""}
                aria-current={step === i + 1 ? "step" : undefined}
              >
                <span>{step > i + 1 ? "✓" : i + 1}</span>
                <small>{s}</small>
              </li>
            ),
          )}
        </ol>
        <div className="form-content">
          <p className="eyebrow">{step} ŽINGSNIS IŠ 4</p>
          <h2 id="step-title" tabIndex={-1}>
            {step === 1
              ? "Kur įsigijote dovaną?"
              : step === 2
                ? "Jūsų pirkimo duomenys"
                : step === 3
                  ? "Pasirinkite savo kalėdinę dovaną"
                  : "Ačiū, kad dalyvaujate!"}
          </h2>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {busy && step === 1 && <p role="status">Įkeliama…</p>}
          {!settings.allowed && !busy && step !== 4 && (
            <p className="error">
              Dalyvavimas šiuo metu negalimas. Bandykite vėliau.
            </p>
          )}
          {step === 1 && (
            <>
              <p>Pasirinkite pirkimo vietą ir tęskite.</p>
              <div className="channels">
                {(
                  [
                    ["online", "Internete", "⌂"],
                    ["shop", "Mūsų parduotuvėje", "♧"],
                    ["retail", "Pas prekybos partnerį", "◇"],
                  ] as const
                ).map(([c, title, icon]) => (
                  <button
                    key={c}
                    className={`channel ${channel === c ? "selected" : ""}`}
                    aria-pressed={channel === c}
                    onClick={() => {
                      setChannel(c);
                      setValues({});
                      setError("");
                    }}
                    disabled={busy}
                  >
                    <span aria-hidden="true">{icon}</span>
                    <strong>{title}</strong>
                    <span className="radio" aria-hidden="true">
                      {channel === c ? "●" : "○"}
                    </span>
                  </button>
                ))}
              </div>
              <button
                className="primary next"
                onClick={next}
                disabled={busy || !settings.allowed}
              >
                Tęsti <span aria-hidden="true">→</span>
              </button>
            </>
          )}
          {step === 2 && channel && (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void next();
              }}
            >
              <p>Įveskite duomenis, nurodytus pirkimo dokumente.</p>
              {labels[channel].map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    name={key}
                    type={
                      key === "buyerEmail"
                        ? "email"
                        : key === "purchaseDate"
                          ? "date"
                          : "text"
                    }
                    max={key === "purchaseDate" ? vilniusDate() : undefined}
                    maxLength={key === "buyerEmail" ? 254 : settings.maxLength}
                    required
                    autoComplete={key === "buyerEmail" ? "email" : "off"}
                    value={values[key] || ""}
                    disabled={busy}
                    aria-invalid={!!fields[key]}
                    aria-describedby={fields[key] ? `${key}-error` : undefined}
                    onChange={(e) => {
                      setValues((v) => ({ ...v, [key]: e.target.value }));
                      setFields((f) => ({ ...f, [key]: "" }));
                    }}
                  />
                  {fields[key] && (
                    <p id={`${key}-error`} className="field-error">
                      {fields[key]}
                    </p>
                  )}
                </div>
              ))}
              <div className="actions">
                <button type="button" onClick={back} disabled={busy}>
                  Atgal
                </button>
                <button
                  className="primary"
                  disabled={busy || !settings.allowed}
                >
                  {busy ? "Tikrinama…" : "Tęsti"}
                </button>
              </div>
            </form>
          )}
          {step === 3 && (
            <>
              <p>Penkios dėžutės. Viena šventinė staigmena jums.</p>
              <div
                className="presents"
                role="group"
                aria-label="Pasirinkite vieną iš penkių dovanų"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`present p${n} ${box === n ? "chosen" : ""}`}
                    aria-label={`Dovana ${n}`}
                    aria-pressed={box === n}
                    disabled={busy}
                    onClick={() => setBox(n)}
                  >
                    <span className="gift" aria-hidden="true">
                      <span className="bow">∞</span>
                      <span className="lid" />
                      <span className="ribbon" />
                    </span>
                    <span className="gift-label">Dovana {n}</span>
                    {box === n && (
                      <span className="tick" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {box > 0 && (
                <form onSubmit={submit} noValidate>
                  <div className="field">
                    <label htmlFor="email">Jūsų el. paštas</label>
                    <input
                      id="email"
                      type="email"
                      maxLength={254}
                      autoComplete="email"
                      value={email}
                      disabled={busy}
                      onChange={(e) => {
                        setEmail(e.target.value);
                        setFields((f) => ({ ...f, email: "" }));
                      }}
                      aria-invalid={!!fields.email}
                      aria-describedby={
                        fields.email ? "email-error" : undefined
                      }
                    />
                    {fields.email && (
                      <p id="email-error" className="field-error">
                        {fields.email}
                      </p>
                    )}
                  </div>
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={consent}
                      disabled={busy}
                      onChange={(e) => {
                        setConsent(e.target.checked);
                        setFields((f) => ({ ...f, consent: "" }));
                      }}
                      aria-invalid={!!fields.consent}
                      aria-describedby={
                        fields.consent ? "consent-error" : undefined
                      }
                    />
                    <span>{settings.consent.text}</span>
                  </label>
                  {fields.consent && (
                    <p id="consent-error" className="field-error">
                      {fields.consent}
                    </p>
                  )}
                  <div className="actions">
                    <button type="button" onClick={back} disabled={busy}>
                      Atgal
                    </button>
                    <button className="primary" disabled={busy}>
                      {busy ? "Registruojama…" : "Gauti dovaną"}
                    </button>
                  </div>
                </form>
              )}
              {!box && (
                <button onClick={back} disabled={busy}>
                  Atgal
                </button>
              )}
            </>
          )}
          {step === 4 && result && (
            <div className="result">
              <span aria-hidden="true" className="seal">
                ✦
              </span>
              <p>
                Jūsų dovana bus išsiųsta el. paštu{" "}
                <strong>{result.email}</strong>.
              </p>
              {settings.mock && (
                <p>Tai demonstracija. Tikras el. laiškas nebus siunčiamas.</p>
              )}
              {result.delayed && (
                <p role="status">
                  Jūsų registracija išsaugota. Dovanos išsiuntimas vėluoja.
                </p>
              )}
              <p className="muted">Linkime jaukių švenčių!</p>
              <button onClick={() => void load()} disabled={busy}>
                Atnaujinti būseną
              </button>
            </div>
          )}
        </div>
        <div className="card-foot">
          <span aria-hidden="true">✧</span> Šventinė staigmena prasideda nuo
          jūsų
        </div>
      </section>
      <footer>
        <p>{organiser}</p>
        <div>
          {rulesUrl ? (
            <a href={rulesUrl}>Konkurso taisyklės</a>
          ) : (
            <span>Taisyklės: kūrimo vietaženklis</span>
          )}
          {privacyUrl ? (
            <a href={privacyUrl}>Privatumo informacija</a>
          ) : (
            <span>Privatumo informacija: kūrimo vietaženklis</span>
          )}
        </div>
      </footer>
    </main>
  );
}
