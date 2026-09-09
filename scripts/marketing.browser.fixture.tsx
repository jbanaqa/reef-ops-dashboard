// Isolated browser fixture: no database, Shopify, or email provider requests.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import FlowEditor from "../app/our-klaviyo/FlowEditor";
import {
  defaultContent,
  defaultMarketingSettings,
} from "../lib/marketing/rules";
const canvas = document.createElement("canvas");
canvas.width = 1400;
canvas.height = 280;
const context = canvas.getContext("2d")!;
context.fillStyle = "#244b7b";
context.fillRect(0, 0, 1400, 280);
context.fillStyle = "white";
context.font = "60px Arial";
context.fillText("Thank you for your business", 220, 160);
const artwork = canvas.toDataURL();
const initial: React.ComponentProps<typeof FlowEditor>["resource"] = {
  id: "browser-b2b",
  key: "b2b-welcome",
  name: "B2B welcome",
  enabled: false,
  data: {
    reviewed: false,
    steps: [
      {
        minutes: 0,
        channel: "EMAIL",
        subject: "Welcome to wholesale",
        content: {
          ...defaultContent,
          template: "b2b-wholesale",
          heading: "Welcome to Corals Anonymous Wholesale!",
          body: 'Hi {{ first_name|default:"Friend" }}!\n\nWelcome to our wholesale community.\n\nDiscover new arrivals and weekly specials selected for your business.\n\nSign into your wholesale account to get started.',
          button: "Explore wholesale",
          url: "https://coralsanonymous.com",
          preview: "Your wholesale account is ready.",
          logo: artwork,
          footerImage: artwork,
          logoScale: 2.5,
          footerScale: 2.5,
        },
      },
    ],
  },
};
function App() {
  const [resource, setResource] = useState(
    () =>
      JSON.parse(localStorage.getItem("fixture.saved") || "null") || initial,
  );
  return (
    <main className="marketing">
      <FlowEditor
        resource={resource}
        settings={{
          ...defaultMarketingSettings,
          postalAddress: "123 Ocean Avenue, California",
        }}
        busy={false}
        save={async (data, enabled) => {
          if (localStorage.getItem("fixture.failSave")) return undefined;
          const saved = { ...resource, data, enabled };
          localStorage.setItem("fixture.saved", JSON.stringify(saved));
          setResource(saved);
          return saved;
        }}
        testEmail={async () => ({ ok: true })}
      />
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
