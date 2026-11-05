// Starter label sets with sample data, so the app can be tried in one click.

export const PRESETS = {
  logs: {
    title: "Log severity",
    labels: [
      {
        name: "error",
        description: "Something failed: exceptions, crashes, refused connections, 5xx responses.",
        keywords: "error, exception, fatal, traceback, panic",
        examples: [
          "ERROR db connection refused after 3 retries",
          "Unhandled exception in worker: NullPointerException",
          "request failed with status 500 internal server error",
          "FATAL out of memory, process killed",
          "payment service timeout, transaction aborted",
        ],
      },
      {
        name: "warning",
        description: "Degraded but working: slow, retrying, deprecated, nearly full.",
        keywords: "warn, deprecated, retrying",
        examples: [
          "WARN disk usage at 85% on /var",
          "slow query took 2400ms on orders table",
          "retrying request to inventory service (attempt 2)",
          "config option cache_ttl is deprecated, use cache.ttl",
          "high memory usage 78% on worker-3",
        ],
      },
      {
        name: "info",
        description: "Normal operation: started, completed, user actions, health checks.",
        keywords: "",
        examples: [
          "INFO server started on port 8080",
          "user 1042 logged in",
          "nightly backup completed in 42s",
          "health check ok",
          "deployed version 2.3.1 to production",
        ],
      },
    ],
    sample: `2026-11-05T10:00:01Z INFO api started on port 3000
2026-11-05T10:00:04Z INFO user 5521 logged in from 10.0.0.12
2026-11-05T10:00:09Z WARN response time 1800ms on /search
2026-11-05T10:00:12Z ERROR redis connection refused, falling back to db
2026-11-05T10:00:15Z INFO cache warmed in 230ms
2026-11-05T10:00:21Z WARN retrying webhook delivery (attempt 3)
2026-11-05T10:00:22Z ERROR Unhandled exception: TypeError cannot read property id of undefined
2026-11-05T10:00:30Z INFO health check ok
2026-11-05T10:00:31Z WARN disk usage at 91% on /data
2026-11-05T10:00:40Z ERROR request failed with status 503 from billing service
2026-11-05T10:00:41Z INFO scheduled report emailed to 14 users
2026-11-05T10:00:47Z WARN api key for partner X expires in 3 days
2026-11-05T10:00:52Z ERROR job export-csv crashed: out of memory
2026-11-05T10:00:58Z INFO user 5521 logged out
2026-11-05T10:01:03Z WARN slow query 3100ms on invoices table
2026-11-05T10:01:09Z INFO deployed version 2.3.2
2026-11-05T10:01:15Z ERROR TLS handshake failed with upstream auth service
2026-11-05T10:01:20Z INFO 1,204 events processed in batch 77`,
  },
  tickets: {
    title: "Support tickets",
    labels: [
      {
        name: "billing",
        description: "Charges, invoices, refunds, plans, payment methods.",
        keywords: "refund, invoice, charged",
        examples: [
          "I was charged twice this month",
          "How do I download my invoice for October?",
          "Please cancel my subscription and refund the last payment",
          "my card was declined when upgrading to pro",
        ],
      },
      {
        name: "bug",
        description: "Something in the product is broken or behaves wrongly.",
        keywords: "crash, broken, error",
        examples: [
          "The export button does nothing on Safari",
          "app crashes when I open settings",
          "dashboard shows the wrong totals since yesterday",
          "getting an error 500 when saving a project",
          "the page freezes and never finishes loading",
          "charts are blank after the update",
        ],
      },
      {
        name: "account",
        description: "Login, password, 2FA, email changes, deleting the account.",
        keywords: "password, login, 2fa",
        examples: [
          "I can't log in, reset email never arrives",
          "how do I change the email on my account",
          "lost my phone, need to disable two factor",
          "please delete my account and data",
        ],
      },
      {
        name: "feature request",
        description: "Ideas and requests for new functionality.",
        keywords: "would be great, please add, feature",
        examples: [
          "would be great to have dark mode",
          "please add an API for exporting reports",
          "can you support SSO with Okta?",
          "feature idea: bulk edit for tags",
        ],
      },
    ],
    sample: `id,customer,message
1001,ana@acme.io,I got charged two times for the annual plan
1002,li@corp.cn,The upload page freezes at 99% and never finishes
1003,sam@mail.com,Forgot my password and the reset link is expired
1004,kai@team.dev,Would love a Slack integration for alerts
1005,jo@shop.co,Where can I find the invoice for my last payment?
1006,max@lab.org,Charts render blank after the latest update
1007,eva@studio.fm,How do I turn off 2FA? I changed phones
1008,raj@build.in,Please add keyboard shortcuts for the editor
1009,mia@home.net,Requesting a refund for the unused months
1010,tom@ops.io,API returns error 500 when the name has emoji
1011,zoe@school.edu,Can I change the email address on my login?
1012,ben@fin.co,It would be great to export dashboards as PDF`,
    sampleName: "tickets.csv",
  },
  sentiment: {
    title: "Review sentiment",
    labels: [
      {
        name: "positive",
        description: "Happy, satisfied, recommends it.",
        keywords: "love, excellent, recommend",
        examples: ["Absolutely love it, works perfectly", "great quality and fast shipping", "best purchase this year, highly recommend"],
      },
      {
        name: "negative",
        description: "Unhappy, broken, disappointed, wants a refund.",
        keywords: "terrible, refund, waste",
        examples: ["stopped working after two days", "terrible support, never again", "waste of money, very disappointed"],
      },
      {
        name: "neutral",
        description: "Mixed or factual, neither clearly good nor bad.",
        keywords: "",
        examples: ["arrived on Tuesday as expected", "it is okay for the price", "does what it says, nothing special"],
      },
    ],
    sample: `The battery life is amazing, I recommend it to everyone
Broke the first time I dropped it, terrible build
Package came in a brown box
Pretty good overall but the strap feels cheap
Customer service refused my refund, never buying again
Exactly as described
I love the colors and the sound is excellent
Not worth it, waste of money
It works`,
  },
};
