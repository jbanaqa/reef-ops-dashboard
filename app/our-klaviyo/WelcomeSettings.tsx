"use client";
import type { FlowConfig } from "@/lib/marketing/flow-config";
export default function WelcomeSettings({
  flow,
  onChange,
  onAudienceChange,
}: {
  flow: FlowConfig;
  onChange: (flow: FlowConfig) => void;
  onAudienceChange: () => void;
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
      <h3>Test audience</h3>
      <label className="mk-check">
        <input
          type="checkbox"
          checked={w.testEmail !== undefined}
          onChange={(e) => {
            onAudienceChange();
            onChange({
              ...flow,
              reviewed: false,
              welcome: {
                ...w,
                testEmail: e.target.checked ? "" : undefined,
                bypassRecentEmailSuppression: e.target.checked
                  ? w.bypassRecentEmailSuppression
                  : undefined,
              },
            });
          }}
        />
        Restrict new enrollments and deliveries to one test email
      </label>
      {w.testEmail !== undefined && (
        <label>
          Test email
          <input
            type="email"
            placeholder="you@example.com"
            value={w.testEmail}
            onChange={(e) => {
              onAudienceChange();
              onChange({
                ...flow,
                reviewed: false,
                welcome: {
                  ...w,
                  testEmail: e.target.value,
                  ...(!e.target.value.trim()
                    ? { bypassRecentEmailSuppression: undefined }
                    : {}),
                },
              });
            }}
          />
        </label>
      )}
      {w.testEmail !== undefined && (
        <label className="mk-check">
          <input
            type="checkbox"
            checked={w.bypassRecentEmailSuppression === true}
            disabled={!w.testEmail.trim()}
            onChange={(e) => {
              onAudienceChange();
              onChange({
                ...flow,
                reviewed: false,
                welcome: {
                  ...w,
                  bypassRecentEmailSuppression: e.target.checked,
                },
              });
            }}
          />
          Bypass 16-hour email suppression for this test account
        </label>
      )}
      <p>
        One entry per subscriber, including tests. Changing the test audience
        pauses the draft until reviewed and saved. Existing test runs cannot
        become customer runs.
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
