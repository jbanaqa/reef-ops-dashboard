export type PaymentVerification = { unverifiedOrders: number; staleOrders?: number };

export default function PaymentVerificationNotice({ verification, className }: {
  verification?: PaymentVerification; className: string;
}) {
  return <>
    {!!verification?.staleOrders && <p className={className} role="status">Using last verified Shopify payments for {verification.staleOrders.toLocaleString()} {verification.staleOrders === 1 ? "order" : "orders"}; refresh pending.</p>}
    {!!verification?.unverifiedOrders && <p className={className} role="status">Shopify payments could not be verified for {verification.unverifiedOrders.toLocaleString()} {verification.unverifiedOrders === 1 ? "order" : "orders"}. Revenue and attribution may be incomplete.</p>}
  </>;
}
