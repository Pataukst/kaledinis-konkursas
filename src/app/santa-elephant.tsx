export default function SantaElephant() {
  return <div className="santa-elephant">
    <svg viewBox="0 0 240 210" role="img" aria-label="Oranžinis Geros dovanos drambliukas su Kalėdų Senelio kepure">
      <circle cx="120" cy="112" r="88" fill="#fff0e3" />
      <circle cx="194" cy="57" r="5" fill="#ff6e00" />
      <path d="M31 75h12m-6-6v12M204 153h12m-6-6v12" stroke="#ff6e00" strokeWidth="3" strokeLinecap="round" />
      <svg x="18" y="41" width="205" height="165" viewBox="0 0 48 42" overflow="hidden">
        <image href="/geradovana-logo.svg" width="188" height="42" />
      </svg>
      <path d="M64 77Q87 3 134 34L161 64Q132 56 120 72Z" fill="#df3d36" />
      <path d="M67 77Q94 62 122 72" fill="none" stroke="white" strokeWidth="15" strokeLinecap="round" />
      <circle cx="161" cy="65" r="12" fill="white" />
    </svg>
    <span>Šventinę staigmeną išsirinkite patys!</span>
  </div>;
}

