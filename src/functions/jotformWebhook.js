import { app } from '@azure/functions';
import { config } from '../lib/config.js';
import { parseSubmission } from '../lib/jotform.js';
import { createReturnLabel } from '../lib/fedex.js';
import { sendLabelEmail } from '../lib/email.js';

async function readRawRequest(request) {
  const contentType = request.headers.get('content-type') || '';

  if (contentType.includes('multipart/form-data') || contentType.includes('application/x-www-form-urlencoded')) {
    const form = await request.formData();
    const raw = form.get('rawRequest');
    if (raw) return raw;
    const obj = {};
    for (const [k, v] of form.entries()) obj[k] = v;
    return JSON.stringify(obj);
  }

  if (contentType.includes('application/json')) {
    const body = await request.json();
    return body.rawRequest || JSON.stringify(body);
  }

  return await request.text();
}

app.http('jotformWebhook', {
  methods: ['POST'],
  authLevel: 'anonymous',
  handler: async (request, context) => {
    try {
      if (config.webhookSharedSecret) {
        const supplied = request.query.get('secret');
        if (supplied !== config.webhookSharedSecret) {
          context.warn('Rejected webhook call: invalid or missing shared secret.');
          return { status: 401, jsonBody: { error: 'unauthorized' } };
        }
      }

      const rawRequest = await readRawRequest(request);
      const submission = parseSubmission(rawRequest);

      context.log(`Received submission for ${submission.fullName} (${submission.email || 'no email'})`);

      if (!submission.address.city || !submission.address.state || !submission.address.zip) {
        context.error('Submission missing required address fields', submission.address);
        return {
          status: 200,
          jsonBody: { status: 'skipped', reason: 'missing address fields' },
        };
      }

      const label = await createReturnLabel(submission);
      context.log(`FedEx label created, tracking: ${label.trackingNumber}`);

      await sendLabelEmail(submission, label);
      context.log(`Email sent to ${config.mail.to.join(', ')}`);

      return {
        status: 200,
        jsonBody: { status: 'ok', trackingNumber: label.trackingNumber },
      };
    } catch (err) {
      context.error('Webhook handler failed:', err);
      return {
        status: 500,
        jsonBody: { status: 'error', message: err.message || String(err) },
      };
    }
  },
});
