export const firstWelcomeBody =
  'Aloha {{ first_name|default:"Friend" }},\n\nWelcome to Corals Anonymous! We’re thrilled to have you join our reefing family. 🐠 💙\n\nOur story started at the peak of COVID. With nowhere to go and too much free time, we turned to the one thing that always made us happy—reefing. Out of that passion (and a little boredom), Corals Anonymous was born.\n\nToday, we’re proud to be a treasure cove for saltwater hobbyists, dealing the most addictive stuff—corals and anemones! We dedicate ourselves to providing:\n\n✨ High-quality, healthy corals and anemones\n✨ Rare and unique selections from around the world\n✨ The best deals for our fellow reefers who can’t get enough of that “reefer-high”\n\nGot questions or just want to talk reefing? Reach us anytime at happyreefing@coralsanonymous.com — we love hearing from our fellow reefers.';

// This is the editable starter markup for the first welcome email. The plain
// copy above remains the fallback and the exact-match upgrade never replaces
// staff-edited content.
export const firstWelcomeBodyHtml = [
  '<p style="margin:0 0 16px">Aloha {{ first_name|default:"Friend" }},</p>',
  '<p style="margin:0 0 16px">Welcome to <strong>Corals Anonymous!</strong> We’re thrilled to have you join our reefing family. 🐠 💙</p>',
  '<p style="margin:0 0 16px">Our story started at the peak of COVID. With nowhere to go and too much free time, we turned to the one thing that always made us happy—<strong>reefing.</strong> Out of that passion (and a little boredom), Corals Anonymous was born.</p>',
  '<p style="margin:0 0 16px">Today, we’re proud to be a <strong>treasure cove for saltwater hobbyists, dealing the most addictive stuff—corals and anemones!</strong> We dedicate ourselves to providing:</p>',
  '<p style="margin:0 0 16px">✨ High-quality, healthy corals and anemones<br>✨ Rare and unique selections from around the world<br>✨ The best deals for our fellow reefers who can’t get enough of that “reefer-high”</p>',
  '<p style="margin:0">Got questions or just want to talk reefing? Reach us anytime at <span style="color:#dc843d;text-decoration:underline">happyreefing@coralsanonymous.com</span> — we love hearing from our fellow reefers.</p>',
].join("");
