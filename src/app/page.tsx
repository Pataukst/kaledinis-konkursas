import Contest from "./contest";
export default function Page() {
  return (
    <Contest
      organiser={
        process.env.ORGANISER_TEXT === "Kūrimo aplinka: organizatoriaus informacija dar nepatvirtinta."
          ? ""
          : process.env.ORGANISER_TEXT || ""
      }
      rulesUrl={process.env.RULES_URL || ""}
      privacyUrl={process.env.PRIVACY_URL || ""}
    />
  );
}
export const dynamic = "force-dynamic";

