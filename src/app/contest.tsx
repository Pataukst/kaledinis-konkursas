"use client";
import { useEffect, useState } from "react";
import {
  claimSchema,
  barcodeLabels,
  barcodeSchema,
  vilniusDate,
} from "@/lib/validation";
import { demoNotice } from "@/lib/config";
import {
  ClientError,
  requestJson,
  userErrorMessage,
} from "@/lib/client-errors";
type Reservation = { id: string; validationId: string; expiresAt: string };
type Result = { id: string; email: string; delayed: boolean; status: string };
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
    [reservation, setReservation] = useState<Reservation | null>(null),
    [remaining, setRemaining] = useState(0),
    [timeOffset, setTimeOffset] = useState(0),
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
    const { response: r, data } = await requestJson("/api/contest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, input }),
    });

    if (!r.ok) {
      setFields(data.fields || {});
      if (action === "claim" && [401, 403].includes(r.status)) await load();
      throw new ClientError(data.error);
    }
    return data;
  }
  async function load() {
    try {
      const { response: r, data } = await requestJson("/api/contest", {
        cache: "no-store",
      });
      const d = data;
      if (!r.ok) throw new ClientError(d.error);
      setSettings(d);
      if (d.claim) {
        setResult(d.claim);
        setStep(3);
      } else if (d.eligible) {
        setReservation(d.reservation);
        if (d.rejected) {
          setRequestKey(crypto.randomUUID());
          sessionStorage.removeItem("claimKey");
          setError(
            "Dovanos priskyrimas atmestas. Galite pateikti naują registraciją iki pradinio rezervacijos termino.",
          );
        }
        setTimeOffset(Date.parse(d.serverTime) - Date.now());
        setStep(2);
      } else {
        setStep(1);
        setReservation(null);
        setBox(0);
        setEmail("");
        setConsent(false);
        setRequestKey(crypto.randomUUID());
        sessionStorage.removeItem("claimKey");
        if (d.expired)
          setError(
            "Jūsų dovanos rezervacijos laikas baigėsi. Patikrinkite pirkimą iš naujo.",
          );
      }
    } catch (e) {
      setError(userErrorMessage(e));
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
  useEffect(() => {
    if (step !== 2 || !reservation) return;
    let checking = false;
    const update = () => {
      const seconds = Math.max(
        0,
        Math.ceil(
          (Date.parse(reservation.expiresAt) - Date.now() - timeOffset) / 1000,
        ),
      );
      setRemaining(seconds);
      if (!seconds && !checking) {
        checking = true;
        void load();
      }
    };
    update();
    const timer = setInterval(update, 1000);
    const verify = () => {
      if (document.visibilityState === "visible") void load();
    };
    document.addEventListener("visibilitychange", verify);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", verify);
    };
  }, [step, reservation, timeOffset]);
  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError("");
    setFields({});
    try {
      await fn();
    } catch (e) {
      setError(userErrorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function next() {
    await run(async () => {
      const input = values;
      const p = barcodeSchema(settings.maxLength).safeParse(input);
      if (!p.success) {
        setFields(
          Object.fromEntries(
            p.error.issues.map((i) => [String(i.path[0]), i.message]),
          ),
        );
        return;
      }
      const d = await api("validate", p.data);
      setTimeOffset(Date.parse(d.serverTime) - Date.now());
      setReservation(d.reservation);
      setRequestKey(crypto.randomUUID());
      setStep(2);
    });
  }
  async function back() {
    await run(async () => {
      await api("invalidate");
      setBox(0);
      setConsent(false);
      setFields({});
      setReservation(null);
      setEmail("");
      setValues({});
      setRequestKey(crypto.randomUUID());
      sessionStorage.removeItem("claimKey");
      setStep(1);
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
      const d = await api("claim", {
        ...p.data,
        reservationId: reservation?.id,
        validationId: reservation?.validationId,
      });
      setResult(d);
      setStep(3);
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
        <ol className="progress" aria-label="Trys dalyvavimo žingsniai">
          {["Pirkimo duomenys", "Jūsų dovana", "Ačiū"].map((s, i) => (
            <li
              key={s}
              className={step >= i + 1 ? "active" : ""}
              aria-current={step === i + 1 ? "step" : undefined}
            >
              <span>{step > i + 1 ? "✓" : i + 1}</span>
              <small>{s}</small>
            </li>
          ))}
        </ol>
        <div className="form-content">
          <p className="eyebrow">{step} ŽINGSNIS IŠ 3</p>
          <h2 id="step-title" tabIndex={-1}>
            {step === 1
              ? "Jūsų pirkimo duomenys"
              : step === 2
                ? "Pasirinkite savo kalėdinę dovaną"
                : "Ačiū, kad dalyvaujate!"}
          </h2>
          {error && (
            <div className="error" role="alert">
              {error}
            </div>
          )}
          {busy && step === 1 && <p role="status">Įkeliama…</p>}
          {!settings.allowed && !busy && step !== 3 && (
            <p className="error">
              Dalyvavimas šiuo metu negalimas. Bandykite vėliau.
            </p>
          )}
          {step === 1 && (
            <form
              noValidate
              onSubmit={(e) => {
                e.preventDefault();
                void next();
              }}
            >
              <p>Įveskite duomenis, nurodytus pirkimo dokumente.</p>
              {barcodeLabels.map(([key, label]) => (
                <div className="field" key={key}>
                  <label htmlFor={key}>{label}</label>
                  <input
                    id={key}
                    name={key}
                    type={key === "purchaseDate" ? "date" : "text"}
                    max={key === "purchaseDate" ? vilniusDate() : undefined}
                    maxLength={settings.maxLength}
                    required
                    autoComplete="off"
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
          {step === 2 && (
            <>
              <p>Penkios dėžutės. Viena šventinė staigmena jums.</p>
              {reservation && (
                <p role="status">
                  Dovana rezervuota iki{" "}
                  {new Intl.DateTimeFormat("lt-LT", {
                    timeZone: "Europe/Vilnius",
                    dateStyle: "short",
                    timeStyle: "short",
                  }).format(new Date(reservation.expiresAt))}
                  . Liko {Math.floor(remaining / 3600)} val.{" "}
                  {Math.floor((remaining % 3600) / 60)} min. {remaining % 60}{" "}
                  sek.
                </p>
              )}
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
                    <label htmlFor="email">Gavėjo el. paštas</label>
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
          {step === 3 && result && (
            <div className="result">
              <span aria-hidden="true" className="seal">
                ✦
              </span>
              <p>
                {result.status === "ASSIGNED"
                  ? "Dovana priskirta. Gavėjo el. paštas išsaugotas."
                  : result.status === "REJECTED"
                    ? "Dovanos priskyrimas atmestas. Atnaujinkite būseną ir bandykite su nauja registracija."
                    : "Jūsų registracija išsaugota. Dovanos priskyrimas tikrinamas."}
              </p>
              {settings.mock && (
                <p>Tai demonstracija. Tikras el. laiškas nebus siunčiamas.</p>
              )}
              {result.delayed && (
                <p role="status">
                  Dovanos priskyrimo būsena bus atnaujinta gavus patvirtinimą.
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
