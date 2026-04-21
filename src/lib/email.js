import { config } from './config.js';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getGraphToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;

  const body = new URLSearchParams({
    client_id: config.graph.clientId,
    client_secret: config.graph.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(
    `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }
  );

  if (!res.ok) {
    throw new Error(`Graph OAuth failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  cachedToken = json.access_token;
  cachedTokenExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}

export async function sendLabelEmail(submission, label) {
  const token = await getGraphToken();

  const subject = `FedEx Return Label — ${submission.fullName}`;
  const lines = [
    `A FedEx return label has been generated for ${submission.fullName}.`,
    '',
    submission.jobTitle ? `Job Title: ${submission.jobTitle}` : null,
    submission.terminationOr ? `Type: ${submission.terminationOr}` : null,
    submission.lastDay ? `Last Day: ${submission.lastDay}` : null,
    submission.email ? `Employee Email: ${submission.email}` : null,
    '',
    `Shipping From:`,
    `  ${submission.fullName}`,
    ...submission.address.streetLines.filter(Boolean).map((l) => `  ${l}`),
    `  ${submission.address.city}, ${submission.address.state} ${submission.address.zip}`,
    '',
    `Shipping To:`,
    `  ${config.returnTo.name}`,
    `  ${config.returnTo.company}`,
    `  ${config.returnTo.street}`,
    `  ${config.returnTo.city}, ${config.returnTo.state} ${config.returnTo.zip}`,
    '',
    `Tracking Number: ${label.trackingNumber}`,
    '',
    `Label PDF is attached.`,
  ].filter((l) => l !== null);

  const message = {
    message: {
      subject,
      body: { contentType: 'Text', content: lines.join('\n') },
      toRecipients: config.mail.to.map((address) => ({ emailAddress: { address } })),
      ccRecipients: config.mail.cc.map((address) => ({ emailAddress: { address } })),
      attachments: [
        {
          '@odata.type': '#microsoft.graph.fileAttachment',
          name: `return-label-${label.trackingNumber}.pdf`,
          contentType: 'application/pdf',
          contentBytes: label.labelPdfBase64,
        },
      ],
    },
    saveToSentItems: true,
  };

  const res = await fetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(config.mail.from)}/sendMail`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(message),
    }
  );

  if (!res.ok) {
    throw new Error(`Graph sendMail failed (${res.status}): ${await res.text()}`);
  }
}
