import SantaElephant from "./santa-elephant";

export default function DeliveryElephant({ box }: { box: number }) {
  return <div className="delivery-scene" role="img" aria-label="Geros dovanos drambliukas tempia jūsų pasirinktą atidarytą dovanų dėžutę">
    <div className="delivery-elephant" aria-hidden="true"><SantaElephant /></div>
    <span className="delivery-rope" aria-hidden="true" />
    <div className={`delivery-present present p${box >= 1 && box <= 5 ? box : 1}`} aria-hidden="true">
      <span className="gift"><span className="bow">∞</span><span className="lid" /><span className="ribbon" /></span>
    </div>
    <span className="delivery-spark" aria-hidden="true">✧</span>
  </div>;
}

