import SaleRotationManager from "./SaleRotationManager";
import "./sale-rotation.css";

export default function SaleRotationPage() {
  return <div className="page-stack sale-rotation-page">
    <section>
      <p className="page-header-eyebrow">Merchandising</p>
      <h2 className="page-title">Sale Rotation</h2>
      <p className="page-description">Rotate Macroalgae Farms products through tiered discounts while keeping Shopify pricing and Sale collection membership synchronized.</p>
    </section>
    <SaleRotationManager />
  </div>;
}
