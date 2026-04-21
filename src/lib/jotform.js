export function parseSubmission(rawRequestJson) {
  const raw = typeof rawRequestJson === 'string' ? JSON.parse(rawRequestJson) : rawRequestJson;

  const pick = (prefix) => {
    const key = Object.keys(raw).find((k) => k.startsWith(prefix));
    return key ? raw[key] : undefined;
  };

  const name = pick('q3_') || {};
  const email = pick('q31_') || '';
  const address = pick('q49_') || {};
  const jobTitle = pick('q26_') || '';
  const terminationOr = pick('q25_') || '';
  const lastDay = pick('q6_') || {};

  const first = (name.first || '').trim();
  const last = (name.last || '').trim();
  const fullName = [first, last].filter(Boolean).join(' ') || 'Unknown';

  const street1 = (address.addr_line1 || '').trim();
  const street2 = (address.addr_line2 || '').trim();
  const streetLines = [street1, street2].filter(Boolean);

  return {
    fullName,
    firstName: first,
    lastName: last,
    email: (email || '').trim(),
    jobTitle: (jobTitle || '').trim(),
    terminationOr: (terminationOr || '').trim(),
    lastDay: lastDay && lastDay.day ? `${lastDay.month}/${lastDay.day}/${lastDay.year}` : '',
    address: {
      streetLines: streetLines.length ? streetLines : [''],
      city: (address.city || '').trim(),
      state: (address.state || '').trim(),
      zip: (address.postal || '').trim(),
      country: normalizeCountry(address.country),
    },
  };
}

function normalizeCountry(input) {
  if (!input) return 'US';
  const s = String(input).trim().toUpperCase();
  if (s === 'US' || s === 'USA' || s === 'UNITED STATES' || s === 'UNITED STATES OF AMERICA') return 'US';
  if (s === 'CA' || s === 'CANADA') return 'CA';
  return s.length === 2 ? s : 'US';
}
