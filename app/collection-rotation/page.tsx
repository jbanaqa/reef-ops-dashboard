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
          Randomize the shared Shopify order of a
          collection so products buried near the bottom
          receive more storefront exposure. Every
          customer sees the same saved order until you
          shuffle it again.
        </p>
      </section>

      <CollectionRotationManager />
    </div>
  );
}