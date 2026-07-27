import CollectionRotationManager from "./CollectionRotationManager";

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
          Rank Shopify collections with a transparent mix of recent performance, exposure opportunity, product freshness, and exploration. Preview every strategy before it changes the shared storefront order.
        </p>
      </section>

      <CollectionRotationManager />
    </div>
  );
}