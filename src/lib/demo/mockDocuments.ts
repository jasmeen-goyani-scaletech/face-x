/**
 * Sample documents for Demo Mode. Generated on demand as vector SVG / real PDF data URLs, so they stay crisp
 * at any zoom and nothing large is stored. Every document is watermarked "SAMPLE" so none can be mistaken
 * for a real record.
 */
import type { UploadedFile } from '../types';

export type MockKind = 'portrait' | 'birthCertificate' | 'certificatePdf' | 'receiptImage' | 'complianceImage' | 'schoolIdCard' | 'kidIdCard' | 'transcriptPdf';

export interface MockDocumentDef {
  id: string; // matches the document id the verification service uses
  label: string;
  kind: MockKind;
  fileName: string;
  required: boolean;
}

export const DEMO_DOCUMENT_DEFS: Record<'player' | 'coach' | 'staff', MockDocumentDef[]> = {
  player: [
    { id: 'profilePhoto', label: 'Face-X Identification Photo', kind: 'portrait', fileName: 'faceX-selfie.svg', required: true },
    { id: 'birthCertificate', label: 'Birth Certificate', kind: 'birthCertificate', fileName: 'birth-certificate.svg', required: true },
    { id: 'schoolId', label: 'School ID', kind: 'schoolIdCard', fileName: 'school-id.svg', required: false },
    { id: 'schoolTranscript', label: 'School Transcript', kind: 'transcriptPdf', fileName: 'school-transcript.pdf', required: true },
    { id: 'californiaKidId', label: 'California Kid ID / Government Photo ID', kind: 'kidIdCard', fileName: 'california-kid-id.svg', required: true }
  ],
  coach: [
    { id: 'livePhoto', label: 'Live Coach Photo', kind: 'portrait', fileName: 'coach-photo.svg', required: true },
    { id: 'firstAidCpr', label: 'First Aid / CPR Certificate', kind: 'certificatePdf', fileName: 'first-aid-cpr.pdf', required: true },
    { id: 'yalfTackle', label: 'YALF Tackle Certificate', kind: 'certificatePdf', fileName: 'yalf-tackle-certificate.pdf', required: true },
    { id: 'backgroundCheckRef', label: 'Live Scan Background Check', kind: 'receiptImage', fileName: 'live-scan-receipt.svg', required: true }
  ],
  staff: [
    { id: 'livePhoto', label: 'Live Staff Photo', kind: 'portrait', fileName: 'staff-photo.svg', required: true },
    { id: 'backgroundCheckRef', label: 'Background-Check Reference', kind: 'certificatePdf', fileName: 'background-check.pdf', required: true },
    { id: 'safeSportUpload', label: 'Safe-Sport Compliance Upload', kind: 'complianceImage', fileName: 'safe-sport-certificate.svg', required: false }
  ]
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const svgUrl = (svg: string) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Studio-style head-and-shoulders portrait (illustrated), varied by name. */
function portraitSvg(name: string): string {
  const h = hash(name);
  const skins = ['#f1c9a5', '#e0a97f', '#c98b5e', '#a86a43', '#8a5232'];
  const hairs = ['#2b1d14', '#4a3222', '#1a1a1a', '#6b4a2b', '#8c6b3f'];
  const shirts = ['#1f6f4d', '#2b6ca3', '#57626b', '#a1660a', '#b23a2e'];
  const skin = skins[h % skins.length];
  const hair = hairs[(h >> 3) % hairs.length];
  const shirt = shirts[(h >> 5) % shirts.length];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 1125" width="900" height="1125">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#dfe6ea"/><stop offset="1" stop-color="#b9c4cb"/></linearGradient>
    <radialGradient id="face" cx=".45" cy=".4" r=".7"><stop offset="0" stop-color="${skin}"/><stop offset="1" stop-color="${skin}" stop-opacity=".82"/></radialGradient>
  </defs>
  <rect width="900" height="1125" fill="url(#bg)"/>
  <path d="M110 1125 C120 850 260 790 450 790 C640 790 780 850 790 1125 Z" fill="${shirt}"/>
  <path d="M370 790 L450 900 L530 790 Z" fill="#fff" opacity=".9"/>
  <rect x="385" y="640" width="130" height="190" rx="40" fill="${skin}"/>
  <path d="M385 760 Q450 830 515 760 L515 800 Q450 850 385 800 Z" fill="#000" opacity=".12"/>
  <ellipse cx="450" cy="470" rx="190" ry="235" fill="url(#face)"/>
  <ellipse cx="262" cy="490" rx="26" ry="48" fill="${skin}"/><ellipse cx="638" cy="490" rx="26" ry="48" fill="${skin}"/>
  <path d="M258 440 C250 230 380 190 450 190 C560 190 650 250 642 440 C610 350 560 300 450 296 C340 300 290 350 258 440 Z" fill="${hair}"/>
  <ellipse cx="375" cy="485" rx="30" ry="16" fill="#fff"/><ellipse cx="525" cy="485" rx="30" ry="16" fill="#fff"/>
  <circle cx="375" cy="486" r="11" fill="#2a1a12"/><circle cx="525" cy="486" r="11" fill="#2a1a12"/>
  <path d="M338 452 Q375 436 412 452" stroke="${hair}" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M488 452 Q525 436 562 452" stroke="${hair}" stroke-width="9" fill="none" stroke-linecap="round"/>
  <path d="M450 500 Q436 560 456 578" stroke="#000" stroke-opacity=".18" stroke-width="7" fill="none" stroke-linecap="round"/>
  <path d="M388 626 Q450 668 512 626" stroke="#7a3b2e" stroke-width="10" fill="none" stroke-linecap="round"/>
  <text x="450" y="1085" font-family="Arial, sans-serif" font-size="30" text-anchor="middle" fill="#000" opacity=".28" letter-spacing="6">SAMPLE PHOTO</text>
</svg>`;
}

interface CertSpec {
  heading: string;
  sub: string;
  intro: string;
  name: string;
  rows: [string, string][];
  footer: string;
  accent: string;
}

/** A portrait-format certificate / form with border, seal and a diagonal SAMPLE watermark. */
function certificateSvg(c: CertSpec): string {
  const rows = c.rows
    .map(
      ([k, v], i) =>
        `<text x="180" y="${880 + i * 92}" font-family="Arial, sans-serif" font-size="28" fill="#5b6470" letter-spacing="2">${esc(k.toUpperCase())}</text>
         <text x="180" y="${924 + i * 92}" font-family="Georgia, serif" font-size="42" fill="#1b2430">${esc(v)}</text>
         <line x1="180" y1="${940 + i * 92}" x2="1060" y2="${940 + i * 92}" stroke="#c9ced6" stroke-width="2"/>`
    )
    .join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1240 1754" width="1240" height="1754">
  <rect width="1240" height="1754" fill="#fbf8ef"/>
  <rect x="50" y="50" width="1140" height="1654" fill="none" stroke="${c.accent}" stroke-width="10"/>
  <rect x="80" y="80" width="1080" height="1594" fill="none" stroke="${c.accent}" stroke-width="3"/>
  <text x="620" y="230" font-family="Georgia, serif" font-size="24" text-anchor="middle" fill="${c.accent}" letter-spacing="3">${esc(c.sub.toUpperCase())}</text>
  <text x="620" y="340" font-family="Georgia, serif" font-size="78" font-weight="bold" text-anchor="middle" fill="#1b2430">${esc(c.heading)}</text>
  <line x1="320" y1="390" x2="920" y2="390" stroke="${c.accent}" stroke-width="4"/>
  <text x="620" y="520" font-family="Georgia, serif" font-size="34" font-style="italic" text-anchor="middle" fill="#5b6470">${esc(c.intro)}</text>
  <text x="620" y="660" font-family="Georgia, serif" font-size="92" text-anchor="middle" fill="#1b2430">${esc(c.name)}</text>
  <line x1="260" y1="700" x2="980" y2="700" stroke="#1b2430" stroke-width="2"/>
  ${rows}
  <g transform="translate(940 1440)">
    <circle r="120" fill="none" stroke="${c.accent}" stroke-width="6"/><circle r="100" fill="none" stroke="${c.accent}" stroke-width="2" stroke-dasharray="6 8"/>
    <text y="-10" font-family="Georgia, serif" font-size="30" text-anchor="middle" fill="${c.accent}">OFFICIAL</text>
    <text y="34" font-family="Georgia, serif" font-size="30" text-anchor="middle" fill="${c.accent}">SEAL</text>
  </g>
  <text x="200" y="1500" font-family="'Brush Script MT', cursive" font-size="64" fill="#1b2430">A. Registrar</text>
  <line x1="180" y1="1520" x2="560" y2="1520" stroke="#1b2430" stroke-width="2"/>
  <text x="180" y="1560" font-family="Arial, sans-serif" font-size="24" fill="#5b6470">${esc(c.footer)}</text>
  <text x="620" y="1000" font-family="Arial, sans-serif" font-size="150" font-weight="bold" text-anchor="middle" fill="#b23a2e" opacity=".11" transform="rotate(-28 620 1000)" letter-spacing="14">SAMPLE</text>
  <text x="620" y="1660" font-family="Arial, sans-serif" font-size="22" text-anchor="middle" fill="#8a939a" letter-spacing="3">DEMONSTRATION DOCUMENT — NOT A REAL RECORD</text>
</svg>`;
}

interface IdCardSpec {
  issuer: string;
  cardTitle: string;
  name: string;
  rows: [string, string][];
  accent: string;
  seed: number;
}

/** Landscape photo-ID card with avatar, details and barcode. Watermarked SAMPLE. */
function idCardSvg(c: IdCardSpec): string {
  const rows = c.rows
    .map(
      ([k, v], i) =>
        `<text x="330" y="${290 + i * 62}" font-family="Arial, sans-serif" font-size="18" fill="#5b6470" letter-spacing="2">${esc(k.toUpperCase())}</text>
         <text x="330" y="${320 + i * 62}" font-family="Arial, sans-serif" font-size="30" font-weight="bold" fill="#1b2430">${esc(v)}</text>`
    )
    .join('');
  const bars = Array.from({ length: 46 }, (_, i) => {
    const w = 3 + ((c.seed >> (i % 12)) & 3);
    return `<rect x="${330 + i * 14}" y="540" width="${w}" height="50" fill="#1b2430"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1011 638" width="1011" height="638">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#eef2f0"/></linearGradient></defs>
  <rect width="1011" height="638" rx="34" fill="url(#g)"/>
  <rect width="1011" height="120" rx="34" fill="${c.accent}"/><rect y="86" width="1011" height="34" fill="${c.accent}"/>
  <text x="48" y="62" font-family="Georgia, serif" font-size="34" font-weight="bold" fill="#fff">${esc(c.issuer)}</text>
  <text x="48" y="98" font-family="Arial, sans-serif" font-size="18" fill="#fff" opacity=".85" letter-spacing="3">${esc(c.cardTitle.toUpperCase())}</text>
  <rect x="48" y="160" width="240" height="300" rx="14" fill="#d6dde2"/>
  <circle cx="168" cy="264" r="62" fill="#9aa6ae"/><path d="M58 460 C70 372 120 346 168 346 C216 346 266 372 278 460 Z" fill="#9aa6ae"/>
  <text x="330" y="196" font-family="Georgia, serif" font-size="44" font-weight="bold" fill="#1b2430">${esc(c.name)}</text>
  <line x1="330" y1="214" x2="960" y2="214" stroke="#c9ced6" stroke-width="2"/>
  ${rows}
  ${bars}
  <text x="505" y="330" font-family="Arial, sans-serif" font-size="120" font-weight="bold" text-anchor="middle" fill="#b23a2e" opacity=".10" transform="rotate(-18 505 330)" letter-spacing="10">SAMPLE</text>
  <text x="505" y="618" font-family="Arial, sans-serif" font-size="14" text-anchor="middle" fill="#8a939a" letter-spacing="3">DEMONSTRATION DOCUMENT — NOT A REAL RECORD</text>
</svg>`;
}

/** Minimal but valid one-page PDF (Helvetica text, border, watermark) with a proper xref table. */
function certificatePdf(title: string, name: string, lines: string[]): string {
  // PDF text here is Latin-1 only: replace anything else, then escape PDF string delimiters.
  const pdfEsc = (s: string) => s.replace(/[^\x20-\x7e\xb7]/g, '?').replace(/[\\()]/g, '\\$&');
  const text = (font: string, size: number, x: number, y: number, s: string, gray = 0) => `${gray} g BT /${font} ${size} Tf ${x} ${y} Td (${pdfEsc(s)}) Tj ET`;
  const content = [
    '0.12 0.44 0.30 RG 3 w 30 30 535 782 re S 1 w 40 40 515 762 re S',
    text('F2', 12, 60, 770, 'SAMPLE ORGANIZATION  ·  CERTIFICATION SERVICES', 0.35),
    text('F2', 30, 60, 700, title),
    text('F1', 14, 60, 660, 'This document certifies that', 0.3),
    text('F2', 26, 60, 620, name),
    ...lines.map((l, i) => text('F1', 14, 60, 560 - i * 34, l, 0.15)),
    '0.7 0.23 0.18 rg BT /F2 84 Tf 0.75 0.66 -0.66 0.75 90 300 Tm (SAMPLE) Tj ET',
    text('F1', 10, 60, 60, 'DEMONSTRATION DOCUMENT - NOT A REAL RECORD', 0.45)
  ].join('\n');

  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>'
  ];
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return `data:application/pdf;base64,${btoa(pdf)}`;
}

/** Builds the sample file for a document definition, personalised with the person's name. */
export function buildMockFile(def: MockDocumentDef, fullName: string): UploadedFile {
  const name = fullName.trim() || 'Sample Person';
  let dataUrl: string;
  switch (def.kind) {
    case 'portrait':
      dataUrl = svgUrl(portraitSvg(name));
      break;
    case 'birthCertificate':
      dataUrl = svgUrl(
        certificateSvg({
          heading: 'Certificate of Live Birth',
          sub: 'State of California · Department of Public Health',
          intro: 'This is to certify that',
          name,
          rows: [
            ['Date of birth', 'November 8, 2013'],
            ['Place of birth', 'Sacramento, California'],
            ['Parent / guardian', 'Jordan & Casey Sample'],
            ['State file number', '113-2013-048218']
          ],
          footer: 'Issued by the Office of the County Registrar',
          accent: '#1f6f4d'
        })
      );
      break;
    case 'receiptImage':
      dataUrl = svgUrl(
        certificateSvg({
          heading: 'Live Scan Applicant Receipt',
          sub: 'Fingerprint background check · Transaction record',
          intro: 'Fingerprints submitted for',
          name,
          rows: [
            ['Reason for request', 'Youth sports coach · Volunteer'],
            ['Agency (ORI)', 'CA0349200 (sample)'],
            ['Transaction number', 'LS-2026-771204'],
            ['Date submitted', 'September 2, 2026']
          ],
          footer: 'Keep this receipt as proof of submission',
          accent: '#2b6ca3'
        })
      );
      break;
    case 'complianceImage':
      dataUrl = svgUrl(
        certificateSvg({
          heading: 'Safe Sport Certificate',
          sub: 'Abuse prevention · Mandatory training',
          intro: 'Certificate of completion awarded to',
          name,
          rows: [
            ['Course', 'SafeSport Trained (Core)'],
            ['Completed', 'August 19, 2026'],
            ['Valid through', 'August 19, 2027'],
            ['Certificate ID', 'SS-990-4471-2026']
          ],
          footer: 'Verify authenticity with the issuing organization',
          accent: '#a1660a'
        })
      );
      break;
    case 'schoolIdCard':
      dataUrl = svgUrl(
        idCardSvg({
          issuer: 'Roosevelt Middle School',
          cardTitle: 'Student identification',
          name,
          rows: [
            ['Student ID', 'S-2026-' + String(hash(name)).slice(-5)],
            ['Grade', '7th'],
            ['Valid through', 'June 2027']
          ],
          accent: '#2b6ca3',
          seed: hash(name)
        })
      );
      break;
    case 'kidIdCard':
      dataUrl = svgUrl(
        idCardSvg({
          issuer: 'State of California',
          cardTitle: 'California Kid ID',
          name,
          rows: [
            ['Date of birth', 'November 8, 2013'],
            ['ID number', 'K' + String(hash(name + 'k')).slice(-8)],
            ['Expires', 'November 8, 2028']
          ],
          accent: '#1f6f4d',
          seed: hash(name + 'k')
        })
      );
      break;
    case 'transcriptPdf':
      dataUrl = certificatePdf('Academic Transcript', name, [
        'School: Roosevelt Middle School',
        'Grade: 7  -  School year 2025-2026',
        'English 7 ......... A-     Math 7 ......... B+',
        'Science 7 ......... A      History 7 ...... B',
        'Physical Education ...... A',
        'Cumulative GPA: 3.62  (sample)'
      ]);
      break;
    default:
      dataUrl = certificatePdf(def.label, name, [
        `Certificate: ${def.label}`,
        'Issued: August 12, 2026',
        'Valid through: August 12, 2028',
        'Certificate ID: CERT-2026-004417',
        'Issuing body: Sample Certification Board'
      ]);
  }
  // Deterministic "upload" details so the same person always shows the same file size and date.
  const size = dataUrl.startsWith('data:image/svg') ? Math.round(dataUrl.length * 0.55) : Math.round(dataUrl.length * 0.75);
  const uploadedAt = Date.UTC(2026, 8, 6 + (hash(name + def.id) % 14), 15 + (hash(def.id) % 4), hash(name) % 60);
  return { uploaded: true, fileName: def.fileName, dataUrl, size, uploadedAt, review: 'pending' };
}

/**
 * Whether this person "uploaded" the document. Required ones always exist; optional ones are omitted for some people
 * (deterministically), so the demo shows both a filled and an empty optional slot.
 */
export function isMockProvided(def: MockDocumentDef, fullName: string): boolean {
  if (def.required) return true;
  return hash(fullName.trim() + def.id) % 5 < 3;
}
