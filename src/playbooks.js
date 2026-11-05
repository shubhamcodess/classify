// Ready-made playbooks. A playbook is what the app is taught: categories to sort rows into,
// decisions to take, and rules that must always hold.
import { PRESETS } from "./presets.js";
import { DECISIONS } from "./bench-decisions.js";

const clone = (x) => JSON.parse(JSON.stringify(x));

export const PLAYBOOKS = {
  support: {
    id: "support",
    name: "Support ticket triage",
    categoryQuestion: "Which category does this support ticket belong to?",
    decisionQuestion: "What should the support team do with this customer message?",
    categories: clone(PRESETS.tickets.labels),
    decisions: clone(DECISIONS),
    rules: [
      { category: "billing", column: "amount", op: ">", value: "500", decision: "Escalate to a person" },
      { column: "plan", op: "is", value: "enterprise", category: "bug", decision: "Escalate to a person" },
    ],
    textHint: ["message", "subject", "description", "body", "text"],
    sampleName: "tickets.csv",
    sample: `Support export, generated 5 Nov 2026
,,,,
id,customer,plan,amount,message
1001,ana@acme.io,pro,120,I got charged two times for the annual plan
1002,li@corp.cn,enterprise,,The upload page freezes at 99% and never finishes
1003,sam@mail.com,free,,Forgot my password and the reset link is expired
1004,kai@team.dev,pro,,Would love a Slack integration for alerts
1005,jo@shop.co,pro,49,Where can I find the invoice for my last payment?
1006,max@lab.org,team,,Charts render blank after the latest update
1007,eva@studio.fm,free,,How do I turn off two factor? I changed phones
1008,raj@build.in,team,,Please add keyboard shortcuts for the editor
1009,mia@home.net,pro,1400,"Requesting a refund, we paid twice for the yearly licence"
1010,tom@ops.io,enterprise,,API returns error 500 when the name has emoji
1011,zoe@school.edu,free,,Can I change the email address on my login?
1012,ben@fin.co,team,,It would be great to export dashboards as PDF
1013,ola@law.no,enterprise,,Our legal team will get involved if our data is not restored today
1014,uma@retail.in,pro,,Someone I don't know is logged in to our account
1015,noa@cafe.il,free,,hmm it's kind of weird lately`,
  },
  logs: {
    id: "logs",
    name: "Log triage",
    categoryQuestion: "What is the severity of this log line?",
    decisionQuestion: "What should the on-call engineer do about this log line?",
    categories: clone(PRESETS.logs.labels),
    decisions: [
      { name: "Page on-call", description: "A service is down or customers are affected right now.", keywords: "", examples: ["FATAL out of memory, process killed", "payment service timeout, transaction aborted", "request failed with status 500 internal server error", "db connection refused after 3 retries"] },
      { name: "Open a ticket", description: "Needs attention soon but nothing is broken yet.", keywords: "", examples: ["disk usage at 85% on /var", "config option is deprecated", "slow query took 2400ms", "certificate expires in 14 days"] },
      { name: "Ignore", description: "Routine operation, nothing to do.", keywords: "", examples: ["server started on port 8080", "user 1042 logged in", "nightly backup completed", "health check ok"] },
    ],
    rules: [],
    sampleName: "app.log",
    sample: PRESETS.logs.sample,
  },
  reviews: {
    id: "reviews",
    name: "Review follow-up",
    categoryQuestion: "What is the sentiment of this review?",
    decisionQuestion: "What should the team do about this review?",
    categories: clone(PRESETS.sentiment.labels),
    decisions: [
      { name: "Reply personally", description: "The customer is unhappy or has a problem someone should resolve.", keywords: "", examples: ["stopped working after two days", "customer service refused my refund", "arrived broken and no one answers"] },
      { name: "Share with the team", description: "Clear praise worth passing on.", keywords: "", examples: ["absolutely love it, works perfectly", "best purchase this year", "the support team was wonderful"] },
      { name: "No action", description: "Factual or neutral, nothing to follow up.", keywords: "", examples: ["arrived on Tuesday as expected", "it is okay for the price", "does what it says"] },
    ],
    rules: [],
    sampleName: "reviews.txt",
    sample: PRESETS.sentiment.sample,
  },
};

export const blankLabel = () => ({ name: "", description: "", keywords: "", examples: [""] });
export const blankPlaybook = (id) => ({ id, name: "New playbook", categoryQuestion: "", decisionQuestion: "", categories: [blankLabel(), blankLabel()], decisions: [], rules: [] });
