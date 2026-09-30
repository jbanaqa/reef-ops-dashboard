"use client";

import type { FlowConfig } from "@/lib/marketing/flow-config";

export default function DeliveryUpsellSettings({
  flow,
  onChange,
}: {
  flow: FlowConfig;
  onChange: (flow: FlowConfig) => void;
}) {
  const delivery = flow.delivery!;
  const update = (patch: Partial<typeof delivery>) =>
    onChange({ ...flow, delivery: { ...delivery, ...patch } });
  return (
    <div className="mk-cart-feed-note">
      <strong>Delivery notice schedule</strong>
      <p>
        Reef Ops reads a month-date order tag, including variants beginning
        with Shipping, Shiping, or Ship, then schedules one email before that
        calendar date. Orders without a recognizable delivery-date tag do not
        enter this flow.
      </p>
      <div className="mk-two">
        <label>
          Calendar days before delivery
          <input
            type="number"
            min={1}
            max={30}
            value={delivery.daysBefore}
            onChange={(e) => update({ daysBefore: Number(e.target.value) })}
          />
        </label>
        <label>
          Send hour (0–23)
          <input
            type="number"
            min={0}
            max={23}
            value={delivery.sendHour}
            onChange={(e) => update({ sendHour: Number(e.target.value) })}
          />
        </label>
      </div>
      <label>
        Scheduling timezone
        <input
          value={delivery.timezone}
          onChange={(e) => update({ timezone: e.target.value })}
        />
      </label>
      <p>
        Current intent: send at 8:00 AM Pacific two calendar days before
        delivery, giving the customer until the following morning to add items.
        Triom handles merging and refunds after checkout.
      </p>
      <p>
        Delivery notices are deadline-sensitive, so recent marketing email does
        not postpone or cancel them. Consent, suppression, purchase-event, and
        provider safety checks still apply.
      </p>
    </div>
  );
}
