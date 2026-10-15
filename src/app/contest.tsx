"use client";
import { useEffect, useState } from "react";
import ContestModal from "./contest-modal";
import SantaElephant from "./santa-elephant";
import DeliveryElephant from "./delivery-elephant";
import privacyPolicy from "@/content/privacy-policy.json";
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
type Result = { id: string; email: string; delayed: boolean; status: string; giftTitle: string; box: number };
export default function Contest({
  organiser,
  rulesUrl,
  privacyUrl,
}: {
  organiser: string;
  rulesUrl: string;
  privacyUrl: string;
}) {
  const [opening, setOpening] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [privacyOpen, setPrivacyOpen] = useState(false);
  const [step, setStep] = useState(1),
    [reservation, setReservation] = useState<Reservation | null>(null),
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
    setDetailsOpen(false);
    setOpening(false);
  }, [step]);
  useEffect(() => {
    if (!opening) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const timer = setTimeout(() => {
      setOpening(false);
      setDetailsOpen(true);
    }, reduced ? 0 : 1500);
    return () => clearTimeout(timer);
  }, [opening]);
  function chooseBox(n: number) {
    if (opening || busy) return;
    setBox(n);
    setConsent(false);
    setFields({});
    setError("");
    setOpening(true);
  }
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
        <div className="form-content">
          <h2 id="step-title" tabIndex={-1}>
            {step === 1
              ? "Jūsų pirkimo duomenys"
              : step === 2
                ? "Pasirinkite savo kalėdinę dovaną"
                : "Ačiū, kad dalyvaujate!"}
          </h2>
          {error && !detailsOpen && (
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
              <SantaElephant />
              <p>Penkios dėžutės. Viena šventinė staigmena jums.</p>
              <div
                className={`presents ${opening ? "opening" : ""}`}
                role="group"
                aria-label="Pasirinkite vieną iš penkių dovanų"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <button
                    key={n}
                    className={`present p${n} ${box === n ? "chosen" : ""}`}
                    aria-label={`Dovana ${n}`}
                    aria-pressed={box === n}
                    disabled={busy || opening}
                    onClick={() => chooseBox(n)}
                  >
                    <span className="gift" aria-hidden="true">
                      <span className="bow">∞</span>
                      <span className="lid" />
                      <span className="ribbon" />
                    </span>
                    {box === n && (
                      <span className="tick" aria-hidden="true">
                        ✓
                      </span>
                    )}
                  </button>
                ))}
              </div>
              {opening && <div className="fireworks" aria-hidden="true">{Array.from({ length: 24 }, (_, i) =>
                <i key={i} style={{ "--angle": `${i * 15}deg`, "--distance": `${95 + i % 4 * 22}px`, "--delay": `${i % 3 * 80}ms` } as React.CSSProperties} />)}</div>}
              <p className="selection-status" role="status">{opening ? "Dėžutė atsidaro…" : box ? "Norėdami tęsti, spustelėkite pasirinktą dovaną." : "Spustelėkite dėžutę ir atraskite Kalėdų magiją."}</p>
              {box > 0 && detailsOpen && (
                <ContestModal title="Dar vienas žingsnis iki dovanos" onClose={() => setDetailsOpen(false)} busy={busy}>
                <p>Dovana jau pakeliui į jūsų el. pašto dėžutę</p>
                {error && <div className="error" role="alert">{error}</div>}
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
                  <div className="check">
                    <input
                      id="contest-consent"
                      aria-labelledby="contest-consent-text"
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
                    <span id="contest-consent-text">{settings.consent.text.includes("privatumo politika") ? <>
                      <label htmlFor="contest-consent">{settings.consent.text.split("privatumo politika")[0]}</label>
                      <a href={privacyPolicy.source} onClick={e => { e.preventDefault(); setPrivacyOpen(true); }}>privatumo politika</a>
                      <label htmlFor="contest-consent">{settings.consent.text.split("privatumo politika").slice(1).join("privatumo politika")}</label>
                    </> : <label htmlFor="contest-consent">{settings.consent.text}</label>}</span>
                  </div>
                  {fields.consent && (
                    <p id="consent-error" className="field-error">
                      {fields.consent}
                    </p>
                  )}
                  <div className="actions">
                    <button type="button" onClick={() => setDetailsOpen(false)} disabled={busy}>
                      Keisti dėžutę
                    </button>
                    <button className="primary" disabled={busy}>
                      {busy ? "Registruojama…" : "Gauti dovaną"}
                    </button>
                  </div>
                </form>
                </ContestModal>
              )}
              {!detailsOpen && (
                <button onClick={back} disabled={busy || opening}>
                  Atgal
                </button>
              )}
            </>
          )}
          {step === 3 && result && (
            <div className="result">
              <DeliveryElephant box={result.box || box} />
              <p className="delivery-message">Sveikiname, jūsų dovana <strong>{result.giftTitle}</strong> jau pakeliui į jūsų pašto dėžutę</p>
              <p className="muted">Linkime jaukių švenčių!</p>
            </div>
          )}
        </div>
        <div className="card-foot">
          <span aria-hidden="true">✧</span> Šventinė staigmena prasideda nuo
          jūsų
        </div>
      </section>
      <footer>
        {organiser && <p>{organiser}</p>}
        <div>
          {rulesUrl && (
            <a href={rulesUrl}>Konkurso taisyklės</a>
          )}
          <a href={privacyUrl || privacyPolicy.source} onClick={e => { e.preventDefault(); setPrivacyOpen(true); }}>Privatumo politika</a>
        </div>
      </footer>
      {privacyOpen && <ContestModal title="Privatumo politika" wide closeOnBackdrop onClose={() => setPrivacyOpen(false)}>
        <article className="policy-content">{privacyPolicy.sections.map((section, i) => <section key={i}>
          <h3>{section.title}</h3><div dangerouslySetInnerHTML={{ __html: section.html }} />
        </section>)}</article>
        <button className="primary" onClick={() => setPrivacyOpen(false)}>Grįžti</button>
      </ContestModal>}
    </main>
  );
}

