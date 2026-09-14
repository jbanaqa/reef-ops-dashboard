"use client";

import type { FlowConfig } from "@/lib/marketing/flow-config";

export default function DeliveryUpsellSettings({
  flow,
  onChange,
  onAudienceChange,
}: {
  flow: FlowConfig;
  onChange: (flow: FlowConfig) => void;
  onAudienceChange: () => void;
}) {
  const delivery = flow.delivery!;
  const update = (patch: Partial<typeof delivery>, audience = false) => {
    if (audience) onAudienceChange();
    onChange({ ...flow, reviewed: audience ? false : flow.reviewed, delivery: { ...delivery, ...patch } });
  };
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
      <label className="mk-check">
        <input
          type="checkbox"
          checked={delivery.testEmail !== undefined}
          onChange={(e) =>
            update(
              {
                testEmail: e.target.checked ? "" : undefined,
                bypassRecentEmailSuppression: false,
              },
              true,
            )
          }
        />
        Restrict this flow to one test email
      </label>
      {delivery.testEmail !== undefined && (
        <>
          <label>
            Test account email
            <input
              type="email"
              value={delivery.testEmail}
              placeholder="you@example.com"
              onChange={(e) =>
                update(
                  { testEmail: e.target.value, bypassRecentEmailSuppression: false },
                  true,
                )
              }
            />
          </label>
          <label className="mk-check">
            <input
              type="checkbox"
              checked={delivery.bypassRecentEmailSuppression === true}
              disabled={!delivery.testEmail.trim()}
              onChange={(e) =>
                update({ bypassRecentEmailSuppression: e.target.checked }, true)
              }
            />
            Bypass 16-hour email suppression for this test account
          </label>
        </>
      )}
    </div>
  );
}
