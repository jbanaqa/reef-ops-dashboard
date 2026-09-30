"use client";
import type { FlowConfig } from "@/lib/marketing/flow-config";
export default function WelcomeSettings({
  flow,
  onChange,
}: {
  flow: FlowConfig;
  onChange: (flow: FlowConfig) => void;
}) {
  const w = flow.welcome!;
  const patch = (values: Partial<typeof w>) =>
    onChange({ ...flow, welcome: { ...w, ...values } });
  return (
    <div className="mk-editor-section">
      <p>
        The welcome email sends immediately. All days below are counted from the
        offer’s activation when that email is prepared.
      </p>
      <div className="mk-two">
        {[1, 2, 3].map((i) => (
          <label key={i}>
            {
              [
                "",
                "First reminder · day",
                "Final reminder · day",
                "Social email · day",
              ][i]
            }
            <input
              type="number"
              min={1}
              max={365}
              step={1}
              value={flow.steps[i].minutes / 1440}
              onChange={(e) =>
                onChange({
                  ...flow,
                  steps: flow.steps.map((s, n) =>
                    n === i
                      ? { ...s, minutes: Number(e.target.value) * 1440 }
                      : s,
                  ),
                })
              }
            />
          </label>
        ))}
        <label>
          Discount expires · day
          <input
            type="number"
            min={2}
            max={90}
            value={w.couponDays}
            onChange={(e) => patch({ couponDays: Number(e.target.value) })}
          />
        </label>
      </div>
      <p>
        {(flow.steps[2].minutes - flow.steps[1].minutes) / 1440} days between
        reminders. The offer expires{" "}
        {w.couponDays - flow.steps[2].minutes / 1440} days after the final
        reminder is scheduled.
      </p>
      <p>
        Both reminders require no order since this Welcome enrollment, a
        successfully sent welcome email, and an unexpired offer. An order after
        signup skips later discount reminders; earlier purchase history does
        not. The social email still follows for subscribed customers.
      </p>
      <div className="mk-two">
        <label>
          Social email · recipient’s local time
          <select
            value={w.socialHour}
            onChange={(e) => patch({ socialHour: Number(e.target.value) })}
          >
            {Array.from({ length: 24 }, (_, h) => (
              <option key={h} value={h}>
                {String(h).padStart(2, "0")}:00
              </option>
            ))}
          </select>
        </label>
        <label>
          Fallback timezone
          <input
            value={w.fallbackTimezone}
            onChange={(e) => patch({ fallbackTimezone: e.target.value })}
          />
        </label>
      </div>
      <p>
        The social email waits until this hour on or after its scheduled day.
        The popup records the browser timezone; the fallback is used when it is
        unavailable.
      </p>
      <p>
        One entry per subscriber, including tests. Use the Test this flow panel
        to prepare a real signup test for a new address; an existing subscriber
        can inspect the email with Send test email.
      </p>
      <p>
        One unique 10% code per subscriber, reused in every offer email. One
        redemption, no minimum, no combinations. Preview codes are not
        redeemable. Existing runs keep their saved schedule and coupon deadline;
        email edits apply before preparation.
      </p>
    </div>
  );
}
