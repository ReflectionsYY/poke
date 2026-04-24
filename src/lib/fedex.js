import { config } from './config.js';

let cachedToken = null;
let cachedTokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAt - 60_000) return cachedToken;

  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: config.fedex.clientId,
    client_secret: config.fedex.clientSecret,
  });

  const res = await fetch(`${config.fedex.baseUrl}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });

  if (!res.ok) {
    throw new Error(`FedEx OAuth failed (${res.status}): ${await res.text()}`);
  }

  const json = await res.json();
  cachedToken = json.access_token;
  cachedTokenExpiresAt = Date.now() + json.expires_in * 1000;
  return cachedToken;
}

export async function createReturnLabel(submission) {
  const token = await getAccessToken();

  const shipper = {
    contact: {
      personName: submission.fullName,
      phoneNumber: config.shipperPhoneFallback,
      emailAddress: submission.email || undefined,
    },
    address: {
      streetLines: submission.address.streetLines,
      city: submission.address.city,
      stateOrProvinceCode: submission.address.state,
      postalCode: submission.address.zip,
      countryCode: submission.address.country,
    },
  };

  const recipient = {
    contact: {
      personName: config.returnTo.name,
      companyName: config.returnTo.company,
      phoneNumber: config.returnTo.phone,
    },
    address: {
      streetLines: [config.returnTo.street, config.returnTo.street2].filter(Boolean),
      city: config.returnTo.city,
      stateOrProvinceCode: config.returnTo.state,
      postalCode: config.returnTo.zip,
      countryCode: config.returnTo.country,
    },
  };

  const payload = {
    labelResponseOptions: 'LABEL',
    accountNumber: { value: config.fedex.accountNumber },
    requestedShipment: {
      shipper,
      recipients: [recipient],
      shipDatestamp: new Date().toISOString().slice(0, 10),
      serviceType: config.fedex.serviceType,
      packagingType: config.fedex.packagingType,
      pickupType: 'DROPOFF_AT_FEDEX_LOCATION',
      shippingChargesPayment: {
        paymentType: 'SENDER',
        payor: {
          responsibleParty: {
            accountNumber: { value: config.fedex.accountNumber },
          },
        },
      },
      labelSpecification: {
        imageType: 'PDF',
        labelStockType: 'PAPER_85X11_TOP_HALF_LABEL',
      },
      requestedPackageLineItems: [
        {
          weight: { units: 'LB', value: config.fedex.defaultWeightLb },
        },
      ],
      shipmentSpecialServices: {
        specialServiceTypes: ['RETURN_SHIPMENT'],
        returnShipmentDetail: { returnType: 'PRINT_RETURN_LABEL' },
      },
    },
  };

  const res = await fetch(`${config.fedex.baseUrl}/ship/v1/shipments`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-locale': 'en_US',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`FedEx ship API failed (${res.status}): ${text}`);
  }

  const json = JSON.parse(text);
  const pieceResponse = json?.output?.transactionShipments?.[0]?.pieceResponses?.[0];
  const packageDocument = pieceResponse?.packageDocuments?.[0];
  const encodedLabel = packageDocument?.encodedLabel;
  const trackingNumber = pieceResponse?.trackingNumber
    || json?.output?.transactionShipments?.[0]?.masterTrackingNumber;

  if (!encodedLabel) {
    throw new Error(`FedEx response missing encodedLabel: ${text}`);
  }

  return {
    trackingNumber: trackingNumber || 'UNKNOWN',
    labelPdfBase64: encodedLabel,
  };
}
