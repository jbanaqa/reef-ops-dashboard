import Link from "next/link";

export default function ReorderPlannerPage() {
  return (
    <div className="page-stack">
      <section>
        <p className="page-header-eyebrow">
          Inventory Operations
        </p>

        <h2 className="page-title">Reorder Planner</h2>

        <p className="page-description">
          Configure supplier mappings and generate recommended
          livestock order quantities using current Shopify stock.
        </p>
      </section>

      <section className="card card-padded">
        <h3 className="card-title">Manage Mappings</h3>

        <p className="card-description">
          Set the supplier product name, reorder threshold,
          standard order quantity, and Shopify variants that draw
          from the same physical inventory.
        </p>

        <div className="action-row">
          <Link
            href="/reorder-planner/mappings"
            className="button button-primary"
          >
            Manage Mappings
          </Link>
        </div>
      </section>

      <section className="card card-padded">
        <h3 className="card-title">
          Upload Supplier Spreadsheet
        </h3>

        <p className="card-description">
          Upload the current RVS stock report, compare mapped
          livestock against live Shopify inventory, and generate
          order recommendations.
        </p>

        <div className="action-row">
          <Link
            href="/reorder-planner/upload"
            className="button button-primary"
          >
            Upload Supplier Spreadsheet
          </Link>
        </div>
      </section>
    </div>
  );
}