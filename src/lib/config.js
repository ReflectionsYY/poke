function req(name) {
  const v = process.env[name];
  if (!v || !v.trim()) throw new Error(`Missing required env var: ${name}`);
  return v.trim();
}

function opt(name, fallback = '') {
  const v = process.env[name];
  return v && v.trim() ? v.trim() : fallback;
}

export const config = {
  fedex: {
    baseUrl: opt('FEDEX_BASE_URL', 'https://apis-sandbox.fedex.com').replace(/\/$/, ''),
    clientId: req('FEDEX_CLIENT_ID'),
    clientSecret: req('FEDEX_CLIENT_SECRET'),
    accountNumber: req('FEDEX_ACCOUNT_NUMBER'),
    serviceType: opt('FEDEX_SERVICE_TYPE', 'FEDEX_GROUND'),
    packagingType: opt('FEDEX_PACKAGING_TYPE', 'YOUR_PACKAGING'),
    defaultWeightLb: Number(opt('FEDEX_DEFAULT_WEIGHT_LB', '1')),
  },
  returnTo: {
    name: opt('RETURN_NAME', 'Collin Chandler'),
    company: opt('RETURN_COMPANY', 'MortgageRight'),
    street: opt('RETURN_STREET', '1 Perimeter Park S'),
    street2: opt('RETURN_STREET_2', 'Suite 230'),
    city: opt('RETURN_CITY', 'Birmingham'),
    state: opt('RETURN_STATE', 'AL'),
    zip: opt('RETURN_ZIP', '35243'),
    country: opt('RETURN_COUNTRY', 'US'),
    phone: opt('RETURN_PHONE', '2057768401'),
  },
  shipperPhoneFallback: opt('SHIPPER_PHONE_FALLBACK', '2057768401'),
  graph: {
    tenantId: req('MS_TENANT_ID'),
    clientId: req('MS_CLIENT_ID'),
    clientSecret: req('MS_CLIENT_SECRET'),
  },
  mail: {
    from: req('MAIL_FROM'),
    to: req('MAIL_TO').split(',').map((s) => s.trim()).filter(Boolean),
    cc: opt('MAIL_CC').split(',').map((s) => s.trim()).filter(Boolean),
  },
  webhookSharedSecret: opt('WEBHOOK_SHARED_SECRET'),
};
