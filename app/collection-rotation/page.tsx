import CollectionRotationManager from "./CollectionRotationManager";
import "./rotation-workspace.css";

export default function CollectionRotationPage() {
  return (
    <div className="page-stack">
      <section>
        <p className="page-header-eyebrow">
          Merchandising
        </p>

        <h2 className="page-title">
          Collection Rotation
        </h2>

        <p className="page-description">
          Keep your storefront fresh. Choose what to feature, preview the product order, and manage automatic rotation.
        </p>
      </section>

      <CollectionRotationManager />
    </div>
  );
}
