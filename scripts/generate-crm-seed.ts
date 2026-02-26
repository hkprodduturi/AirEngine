/**
 * CRM Sales Pipeline — Deterministic Messy Demo Data Generator
 *
 * Generates realistic, intentionally messy business data:
 * - Mixed casing, extra whitespace, inconsistent formats
 * - Stale/overdue tasks, missing optional fields
 * - Realistic but imperfect CRM data
 *
 * Usage: cd demo-output/crm-sales-pipeline/server && npx tsx ../../../scripts/generate-crm-seed.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Deterministic "random" using simple LCG
let _seed = 42;
function rand(): number {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
}
function pick<T>(arr: T[]): T { return arr[Math.floor(rand() * arr.length)]; }
function pickN<T>(arr: T[], n: number): T[] {
  const shuffled = [...arr].sort(() => rand() - 0.5);
  return shuffled.slice(0, n);
}
function randInt(min: number, max: number): number { return Math.floor(rand() * (max - min + 1)) + min; }
function randFloat(min: number, max: number): number { return Math.round((rand() * (max - min) + min) * 100) / 100; }
function daysAgo(n: number): Date { const d = new Date('2026-02-20T12:00:00Z'); d.setDate(d.getDate() - n); return d; }
function daysFromNow(n: number): Date { const d = new Date('2026-02-20T12:00:00Z'); d.setDate(d.getDate() + n); return d; }

// ---- Messy Data Pools ----

const FIRST_NAMES = [
  'Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Hank',
  'Iris', 'Jack', 'Karen', 'Leo', 'Mona', 'Nate', 'Olivia', 'Pete',
  'Quinn', 'Rachel', 'Sam', 'Tina', 'Uma', 'Victor', 'Wendy', 'Xavier',
];

const LAST_NAMES = [
  'Anderson', 'Brown', 'Chen', 'Davis', 'Evans', 'Foster', 'Garcia',
  'Hughes', 'Ivanov', 'Johnson', 'Kim', 'Lee', 'Martinez', 'Nguyen',
  'O\'Brien', 'Patel', 'Quinn', 'Robinson', 'Smith', 'Thompson',
];

// Intentionally messy company names — mixed casing, abbreviations, typos
const COMPANIES = [
  'Acme Corp', 'ACME CORPORATION', 'acme corp.',
  'TechNova Solutions', 'technova', 'TechNova  Solutions',  // extra space
  'GlobalSync Inc', 'Global Sync Inc.', 'globalsync',
  'Pinnacle Systems', 'PINNACLE SYSTEMS', 'Pinnacle Sys.',
  'BlueSky Ventures', 'Blue Sky Ventures', 'bluesky ventures',
  'Meridian Group', 'The Meridian Group', 'meridian grp',
  'Atlas Industries', 'Atlas  Industries', 'ATLAS IND',
  'Vertex Partners', 'vertex partners llc', 'Vertex Partners LLC',
  'Ironclad Security', 'IronClad Sec', 'ironclad security inc',
  'Cascade Analytics', 'CASCADE ANALYTICS', 'Cascade analytics',
  'Summit Health', 'Summit healthcare', 'SUMMIT HEALTH INC',
  'Quantum Dynamics', 'quantum dynamics', 'Quantum Dynamics Co.',
  'NexGen Software', 'nexgen sw', 'NexGen Software Inc.',
  'Orion Consulting', 'orion consulting group', 'ORION CONSULT',
  'Redwood Capital', 'RedWood Capital', 'redwood cap.',
];

const INDUSTRIES = [
  'Technology', 'technology', 'TECHNOLOGY', 'tech',
  'Healthcare', 'healthcare', 'Health Care',
  'Finance', 'finance', 'Financial Services', 'fintech',
  'Manufacturing', 'manufacturing', 'MFG',
  'Retail', 'retail', 'E-Commerce', 'ecommerce',
  'Consulting', 'consulting', 'Professional Services',
  'Real Estate', 'real estate', 'Real estate',
  'Education', 'education', 'EdTech',
  'Energy', 'energy', 'Oil & Gas', 'Renewable Energy',
  'Media', 'media', 'Entertainment', 'Digital Media',
];

const TITLES = [
  'CEO', 'CTO', 'VP of Sales', 'VP Sales', 'vp of sales',
  'Director of Engineering', 'Dir. Engineering', 'director engineering',
  'Sales Manager', 'sales manager', 'Sr. Sales Manager',
  'Account Executive', 'account executive', 'AE',
  'Marketing Director', 'marketing dir', 'Dir. Marketing',
  'CFO', 'Chief Financial Officer', 'Head of Finance',
  'Product Manager', 'PM', 'product manager',
  'Operations Manager', 'ops manager', 'Director of Operations',
  null, null, null, // some contacts have no title
];

// Messy phone formats
const PHONE_FORMATS = [
  (a: string, b: string, c: string) => `(${a}) ${b}-${c}`,
  (a: string, b: string, c: string) => `${a}-${b}-${c}`,
  (a: string, b: string, c: string) => `${a}.${b}.${c}`,
  (a: string, b: string, c: string) => `+1 ${a} ${b} ${c}`,
  (a: string, b: string, c: string) => `+1${a}${b}${c}`,
  (a: string, b: string, c: string) => ` (${a}) ${b}-${c} `, // leading/trailing space
  () => null, // some have no phone
  () => null,
];

function messyPhone(): string | null {
  const fmt = pick(PHONE_FORMATS);
  const area = String(randInt(200, 999));
  const pre = String(randInt(200, 999));
  const line = String(randInt(1000, 9999));
  return fmt(area, pre, line);
}

// Messy emails — some with leading/trailing spaces
function messyEmail(first: string, last: string, company: string): string {
  const domain = company.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) + '.com';
  const formats = [
    `${first.toLowerCase()}.${last.toLowerCase()}@${domain}`,
    `${first.toLowerCase()[0]}${last.toLowerCase()}@${domain}`,
    `${first.toLowerCase()}@${domain}`,
    ` ${first.toLowerCase()}.${last.toLowerCase()}@${domain}`, // leading space
    `${first.toLowerCase()}.${last.toLowerCase()}@${domain} `, // trailing space
  ];
  return pick(formats);
}

// Messy tags
const TAG_POOL = [
  'enterprise', 'Enterprise', 'ENTERPRISE',
  'smb', 'SMB', 'small business',
  'hot lead', 'HOT LEAD', 'hot-lead', 'Hot Lead',
  'vip', 'VIP', 'Vip',
  'needs follow-up', 'NEEDS FOLLOW UP', 'follow up', 'follow-up',
  'decision maker', 'Decision Maker', 'decision-maker',
  'budget approved', 'Budget Approved', 'BUDGET APPROVED',
  'competitor', 'Competitor', 'competitive',
  'referral', 'Referral', 'REFERRAL',
  'upsell', 'Upsell', 'UPSELL', 'cross-sell',
  'renewal', 'Renewal', 'contract renewal',
  'at risk', 'At Risk', 'AT RISK', 'at-risk',
  'champion', 'Champion', 'internal champion',
];

// Activity subjects and bodies
const CALL_SUBJECTS = [
  'Discovery call with {name}',
  'Follow-up call re: proposal',
  'Pricing discussion',
  'Quarterly review call',
  'Cold call - initial outreach',
  'Demo walkthrough',
  'Contract negotiation call',
  'Check-in call',
];

const EMAIL_SUBJECTS = [
  'Re: Proposal for {company}',
  'Following up on our conversation',
  'Pricing breakdown attached',
  'Next steps for {company}',
  'Introduction - {name} from SalesPipe',
  'Contract draft for review',
  'Thank you for the meeting',
  'Quick question about requirements',
];

const MEETING_SUBJECTS = [
  'Onsite demo at {company}',
  'Lunch with {name}',
  'Team intro meeting',
  'Executive briefing',
  'Product roadmap review',
  'Partnership discussion',
  'Quarterly business review',
];

const NOTE_BODIES = [
  'Spoke with {name} - very interested in enterprise plan. Budget cycle starts Q3.',
  'Left voicemail, no answer. Will try again Thursday.',
  '{name} mentioned they are evaluating 3 vendors. We are in the running but need to sharpen pricing.',
  'Great meeting! {name} loved the demo. Sending proposal EOD.',
  'URGENT: {company} might churn. Competitor offering 20% discount. Need exec involvement.',
  '{name} OOO until March. Follow up then.',
  'Internal champion at {company} left the company. Need to rebuild relationship.',
  'Deal stuck. {name} says legal review taking longer than expected.',
  'Signed NDA. Moving forward with technical evaluation next week.',
  'Budget cut. Deal pushed to Q4. Keep warm.',
  'Referral from {name} at {company} - high priority lead.',
  'Met at trade show. Exchanged cards. Interested in analytics module.',
  '',  // some notes are empty
  '   ',  // some are just whitespace
];

const DEAL_NAMES = [
  '{company} - Enterprise License',
  '{company} - Annual Renewal',
  '{company} Analytics Platform',
  '{company} Cloud Migration',
  '{company} Security Suite',
  '{company} - Professional Services',
  '{company} Integration Project',
  '{company} Expansion',
  '{company} - Pilot Program',
  '{company} Digital Transformation',
];

const TASK_TITLES = [
  'Follow up with {name} at {company}',
  'Send proposal to {company}',
  'Schedule demo for {company}',
  'Update CRM notes for {name}',
  'Prepare presentation for {company} meeting',
  'Review contract terms for {company}',
  'Call {name} re: pricing concerns',
  'Send case study to {name}',
  'Coordinate with engineering on {company} requirements',
  'Weekly pipeline review',
  'Update forecast for Q1',
  'Follow up on overdue invoice - {company}',
  'Prepare QBR deck for {company}',
  'Onboard new contact at {company}',
  'Send thank you note to {name}',
];

const CITIES = [
  'San Francisco', 'New York', 'Austin', 'Chicago', 'Seattle',
  'Denver', 'Boston', 'Los Angeles', 'Atlanta', 'Miami',
  'Portland', 'Nashville', 'Phoenix', 'Dallas', 'Minneapolis',
  null, null, // some accounts have no city
];

const STATES = ['CA', 'NY', 'TX', 'IL', 'WA', 'CO', 'MA', 'GA', 'FL', 'OR', 'TN', 'AZ', 'MN', null];
const COUNTRIES = ['US', 'USA', 'United States', 'us', null]; // inconsistent

const LEAD_SOURCES = ['web', 'referral', 'cold_call', 'trade_show', 'partner', 'other'] as const;
const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'unqualified', 'converted'] as const;
const OPP_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation', 'closed_won', 'closed_lost'] as const;
const TASK_STATUSES = ['pending', 'in_progress', 'completed', 'cancelled'] as const;
const TASK_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;
const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note'] as const;

async function main() {
  // Clear existing data
  await prisma.tag.deleteMany();
  await prisma.activity.deleteMany();
  await prisma.task.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.lead.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();

  console.log('Seeding CRM demo data (messy + realistic)...');

  // ---- Users (6) ----
  const users = await Promise.all([
    prisma.user.create({ data: { email: 'sarah@salespipe.com', name: 'Sarah Chen', phone: '(415) 555-0100', title: 'VP of Sales', role: 'admin', password: 'admin123' } }),
    prisma.user.create({ data: { email: 'mike@salespipe.com', name: 'Mike Johnson', phone: '415-555-0101', title: 'Sales Manager', role: 'sales_manager', password: 'manager1' } }),
    prisma.user.create({ data: { email: 'lisa@salespipe.com', name: 'Lisa Park', phone: '+1 415 555 0102', title: 'Sr. Account Executive', role: 'sales_rep', password: 'rep123' } }),
    prisma.user.create({ data: { email: 'james@salespipe.com', name: 'James Wilson', phone: '(415) 555-0103', title: 'Account Executive', role: 'sales_rep', password: 'rep123' } }),
    prisma.user.create({ data: { email: 'ana@salespipe.com', name: 'Ana Rodriguez', phone: '415.555.0104', title: 'SDR', role: 'sales_rep', password: 'rep123' } }),
    prisma.user.create({ data: { email: 'tom@salespipe.com', name: 'Tom Bradley', title: 'Business Development Rep', role: 'sales_rep', password: 'rep123' } }), // no phone
  ]);
  console.log(`  Created ${users.length} users`);

  // ---- Accounts (25) ----
  const accountData: any[] = [];
  const usedCompanies = new Set<string>();
  for (let i = 0; i < 25; i++) {
    let company = pick(COMPANIES);
    while (usedCompanies.has(company.trim().toLowerCase())) {
      company = pick(COMPANIES);
    }
    usedCompanies.add(company.trim().toLowerCase());

    accountData.push({
      name: company,
      industry: pick(INDUSTRIES),
      website: rand() > 0.3 ? `https://www.${company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com` : null,
      phone: messyPhone(),
      city: pick(CITIES),
      state: pick(STATES),
      country: pick(COUNTRIES),
      annual_revenue: rand() > 0.2 ? randFloat(50000, 50000000) : null,
      employee_count: rand() > 0.25 ? randInt(5, 10000) : null,
      owner_id: pick(users).id,
      status: pick(['active', 'active', 'active', 'prospect', 'prospect', 'inactive'] as const),
      notes: rand() > 0.5 ? pick(NOTE_BODIES).replace(/\{company\}/g, company).replace(/\{name\}/g, pick(FIRST_NAMES)) : null,
      created_at: daysAgo(randInt(1, 365)),
    });
  }
  const accounts = [];
  for (const d of accountData) {
    accounts.push(await prisma.account.create({ data: d }));
  }
  console.log(`  Created ${accounts.length} accounts`);

  // ---- Contacts (60) ----
  const contacts = [];
  for (let i = 0; i < 60; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const account = pick(accounts);
    contacts.push(await prisma.contact.create({
      data: {
        first_name: rand() > 0.9 ? firstName.toUpperCase() : firstName, // occasionally ALL CAPS
        last_name: rand() > 0.9 ? lastName.toUpperCase() : lastName,
        email: rand() > 0.1 ? messyEmail(firstName, lastName, account.name) : null,
        phone: messyPhone(),
        title: pick(TITLES),
        account_id: account.id,
        owner_id: pick(users).id,
        lead_source: pick([...LEAD_SOURCES]),
        status: rand() > 0.15 ? 'active' : 'inactive',
        created_at: daysAgo(randInt(1, 300)),
      },
    }));
  }
  console.log(`  Created ${contacts.length} contacts`);

  // ---- Leads (40) ----
  const leads = [];
  for (let i = 0; i < 40; i++) {
    const firstName = pick(FIRST_NAMES);
    const lastName = pick(LAST_NAMES);
    const company = pick(COMPANIES);
    leads.push(await prisma.lead.create({
      data: {
        first_name: rand() > 0.85 ? `  ${firstName}` : firstName, // occasional leading space
        last_name: rand() > 0.85 ? `${lastName}  ` : lastName, // occasional trailing space
        email: rand() > 0.15 ? messyEmail(firstName, lastName, company) : null,
        phone: messyPhone(),
        company: rand() > 0.1 ? company : null, // some leads have no company
        title: pick(TITLES),
        source: pick([...LEAD_SOURCES]),
        status: pick([...LEAD_STATUSES]),
        owner_id: rand() > 0.2 ? pick(users).id : null, // some unassigned
        notes: rand() > 0.4 ? pick(NOTE_BODIES).replace(/\{company\}/g, company).replace(/\{name\}/g, firstName) : null,
        created_at: daysAgo(randInt(0, 180)),
      },
    }));
  }
  console.log(`  Created ${leads.length} leads`);

  // ---- Opportunities (35) ----
  const opps = [];
  for (let i = 0; i < 35; i++) {
    const account = pick(accounts);
    const contact = contacts.find(c => c.account_id === account.id) || pick(contacts);
    const stage = pick([...OPP_STAGES]);
    const amount = stage === 'closed_lost' ? randFloat(10000, 500000) :
                   stage === 'closed_won' ? randFloat(15000, 800000) :
                   randFloat(5000, 1000000);
    const prob = stage === 'prospecting' ? randInt(5, 20) :
                 stage === 'qualification' ? randInt(20, 40) :
                 stage === 'proposal' ? randInt(40, 60) :
                 stage === 'negotiation' ? randInt(60, 85) :
                 stage === 'closed_won' ? 100 :
                 0;
    opps.push(await prisma.opportunity.create({
      data: {
        name: pick(DEAL_NAMES).replace(/\{company\}/g, account.name.trim()),
        amount,
        stage,
        close_date: rand() > 0.2 ? (stage.startsWith('closed') ? daysAgo(randInt(0, 60)) : daysFromNow(randInt(5, 120))) : null,
        probability: prob,
        description: rand() > 0.3 ? `${account.name.trim()} deal - ${pick(['initial engagement', 'expansion', 'renewal', 'new logo', 'upsell'])}` : null,
        account_id: account.id,
        contact_id: contact.id,
        owner_id: pick(users).id,
        created_at: daysAgo(randInt(1, 200)),
      },
    }));
  }
  console.log(`  Created ${opps.length} opportunities`);

  // ---- Tasks (50) — include overdue/stale ones ----
  const tasks = [];
  for (let i = 0; i < 50; i++) {
    const relatedTypes = ['lead', 'contact', 'opportunity', 'account', null];
    const relatedType = pick(relatedTypes);
    let relatedId: number | null = null;
    let relatedName = '';
    if (relatedType === 'lead') { const l = pick(leads); relatedId = l.id; relatedName = `${l.first_name} ${l.last_name}`; }
    else if (relatedType === 'contact') { const c = pick(contacts); relatedId = c.id; relatedName = `${c.first_name} ${c.last_name}`; }
    else if (relatedType === 'opportunity') { const o = pick(opps); relatedId = o.id; relatedName = o.name; }
    else if (relatedType === 'account') { const a = pick(accounts); relatedId = a.id; relatedName = a.name; }

    const status = pick([...TASK_STATUSES]);
    // Make ~30% of pending tasks overdue
    const isOverdue = status === 'pending' && rand() > 0.7;
    const dueDate = rand() > 0.15
      ? (isOverdue ? daysAgo(randInt(1, 30)) : status === 'completed' ? daysAgo(randInt(0, 14)) : daysFromNow(randInt(1, 45)))
      : null;

    tasks.push(await prisma.task.create({
      data: {
        title: pick(TASK_TITLES).replace(/\{name\}/g, pick(FIRST_NAMES)).replace(/\{company\}/g, pick(COMPANIES).trim()),
        description: rand() > 0.5 ? pick(NOTE_BODIES).replace(/\{name\}/g, pick(FIRST_NAMES)).replace(/\{company\}/g, pick(COMPANIES).trim()) : null,
        status,
        priority: pick([...TASK_PRIORITIES]),
        due_date: dueDate,
        owner_id: rand() > 0.15 ? pick(users).id : null,
        related_type: relatedType,
        related_id: relatedId,
        created_at: daysAgo(randInt(0, 90)),
      },
    }));
  }
  console.log(`  Created ${tasks.length} tasks (${tasks.filter(t => t.status === 'pending' && t.due_date && t.due_date < new Date()).length} overdue)`);

  // ---- Activities (80) ----
  const activities = [];
  for (let i = 0; i < 80; i++) {
    const type = pick([...ACTIVITY_TYPES]);
    const contact = pick(contacts);
    const opp = rand() > 0.4 ? pick(opps) : null;
    const user = pick(users);
    const contactName = `${contact.first_name} ${contact.last_name}`.trim();
    const company = accounts.find(a => a.id === contact.account_id)?.name || 'Unknown';

    let subject: string;
    let body: string | null = null;
    let duration: number | null = null;

    if (type === 'call') {
      subject = pick(CALL_SUBJECTS).replace(/\{name\}/g, contactName).replace(/\{company\}/g, company.trim());
      duration = pick([5, 10, 15, 20, 30, 45, 60, null]);
      body = rand() > 0.4 ? pick(NOTE_BODIES).replace(/\{name\}/g, contactName).replace(/\{company\}/g, company.trim()) : null;
    } else if (type === 'email') {
      subject = pick(EMAIL_SUBJECTS).replace(/\{name\}/g, contactName).replace(/\{company\}/g, company.trim());
      body = rand() > 0.3 ? pick(NOTE_BODIES).replace(/\{name\}/g, contactName).replace(/\{company\}/g, company.trim()) : null;
    } else if (type === 'meeting') {
      subject = pick(MEETING_SUBJECTS).replace(/\{name\}/g, contactName).replace(/\{company\}/g, company.trim());
      duration = pick([30, 45, 60, 90, 120]);
      body = rand() > 0.3 ? pick(NOTE_BODIES).replace(/\{name\}/g, contactName).replace(/\{company\}/g, company.trim()) : null;
    } else {
      subject = `Note on ${contactName}`;
      body = pick(NOTE_BODIES).replace(/\{name\}/g, contactName).replace(/\{company\}/g, company.trim());
    }

    activities.push(await prisma.activity.create({
      data: {
        type,
        subject,
        body,
        duration_minutes: duration,
        contact_id: contact.id,
        opportunity_id: opp?.id || null,
        user_id: user.id,
        created_at: daysAgo(randInt(0, 120)),
      },
    }));
  }
  console.log(`  Created ${activities.length} activities`);

  // ---- Tags (120) — intentionally messy/duplicate ----
  const tagEntries: { name: string; entity_type: string; entity_id: number }[] = [];
  for (const account of accounts) {
    const numTags = randInt(0, 4);
    for (let j = 0; j < numTags; j++) {
      tagEntries.push({ name: pick(TAG_POOL), entity_type: 'account', entity_id: account.id });
    }
  }
  for (const opp of opps) {
    const numTags = randInt(0, 3);
    for (let j = 0; j < numTags; j++) {
      tagEntries.push({ name: pick(TAG_POOL), entity_type: 'opportunity', entity_id: opp.id });
    }
  }
  for (const lead of leads.slice(0, 20)) {
    const numTags = randInt(0, 2);
    for (let j = 0; j < numTags; j++) {
      tagEntries.push({ name: pick(TAG_POOL), entity_type: 'lead', entity_id: lead.id });
    }
  }
  await prisma.tag.createMany({ data: tagEntries });
  console.log(`  Created ${tagEntries.length} tags`);

  // ---- Summary ----
  const openDeals = opps.filter(o => !o.stage.startsWith('closed'));
  const wonDeals = opps.filter(o => o.stage === 'closed_won');
  const pipelineValue = openDeals.reduce((s, o) => s + o.amount, 0);
  const wonValue = wonDeals.reduce((s, o) => s + o.amount, 0);
  const winRate = opps.length > 0 ? (wonDeals.length / opps.length * 100) : 0;

  console.log('\n=== CRM Demo Data Summary ===');
  console.log(`  Users:         ${users.length}`);
  console.log(`  Accounts:      ${accounts.length}`);
  console.log(`  Contacts:      ${contacts.length}`);
  console.log(`  Leads:         ${leads.length}`);
  console.log(`  Opportunities: ${opps.length} (pipeline: $${Math.round(pipelineValue).toLocaleString()}, won: $${Math.round(wonValue).toLocaleString()}, win rate: ${winRate.toFixed(0)}%)`);
  console.log(`  Tasks:         ${tasks.length}`);
  console.log(`  Activities:    ${activities.length}`);
  console.log(`  Tags:          ${tagEntries.length}`);
  console.log(`  Total records: ${users.length + accounts.length + contacts.length + leads.length + opps.length + tasks.length + activities.length + tagEntries.length}`);
  console.log('\nDirty data categories:');
  console.log('  - Mixed casing in company names and industries');
  console.log('  - Leading/trailing whitespace in names and emails');
  console.log('  - Inconsistent phone formats (parens, dots, dashes, +1)');
  console.log('  - Missing optional fields (phone, email, title, city)');
  console.log('  - Overdue/stale tasks with past due dates');
  console.log('  - Empty/whitespace-only notes');
  console.log('  - Duplicate/inconsistent tags');
  console.log('  - Inconsistent country values (US/USA/United States)');
  console.log('\nDone.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(e => { console.error(e); prisma.$disconnect(); process.exit(1); });
