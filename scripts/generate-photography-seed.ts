/**
 * generate-photography-seed.ts — Deterministic, messy, realistic seed data
 * for the Lumière Studio photography flagship app.
 *
 * Usage: npx tsx scripts/generate-photography-seed.ts
 * Runs: cd demo-output/photography-studio/server && npx tsx seed.ts
 */

import { PrismaClient } from './demo-output/photography-studio/server/node_modules/@prisma/client/index.js';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Lumière Studio database...\n');

  // ---- Users (studio team) ----
  const users = [
    { email: 'elena@lumiere.studio', name: 'Elena Marchetti', role: 'admin', password: 'admin123' },
    { email: 'james@lumiere.studio', name: 'James Chen', role: 'studio_manager', password: 'studio123' },
    { email: 'sofia@lumiere.studio', name: 'Sofia Reyes', role: 'editor', password: 'editor123' },
  ];

  for (const u of users) {
    await prisma.user.create({ data: u });
  }
  console.log(`  Created ${users.length} users`);

  // ---- Projects (portfolio — intentionally messy metadata) ----
  const projects = [
    // Weddings
    { title: 'The Anderson-Takahashi Wedding at Castello di Vincigliata, Fiesole, Tuscany', slug: 'anderson-takahashi-tuscany', category: 'weddings', location: 'Fiesole, Tuscany, Italy', description: 'An intimate destination wedding set against the medieval walls of a restored 11th-century castle. Golden hour ceremony with panoramic views of the Arno Valley.', story: 'Sarah and Kenji chose Tuscany for its timeless beauty. The ceremony took place at golden hour on the castle terrace, with the rolling hills of Fiesole glowing amber below. We documented every detail — from the hand-tied olive branch bouquet to the laughter-filled first dance under centuries-old stone arches.', date: '2024-09-14', client_type: 'Private', featured: true, cover_color: '#8B7355', sort_order: 1 },
    { title: 'Maya & David — Intimate Elopement', slug: 'maya-david-elopement', category: 'weddings', location: 'Big Sur, California', description: 'A foggy morning elopement on the cliffs of Big Sur. Just the two of them, the ocean, and a promise.', story: 'Maya and David wanted something stripped of pretense — no guest list, no reception hall. Just vows on the edge of the Pacific. The marine layer rolled in at sunrise, wrapping everything in silver.', date: '2024-06-22', client_type: 'Private', featured: true, cover_color: '#6B8E9B', sort_order: 2 },
    { title: 'Nguyen-Park Summer Garden Wedding', slug: 'nguyen-park-garden', category: 'weddings', location: 'San Francisco Botanical Garden, Golden Gate Park', description: 'A vibrant garden celebration blending Vietnamese and Korean traditions. 180 guests, three dress changes, and an emotional tea ceremony.', date: '2024-08-03', client_type: 'Private', featured: false, cover_color: '#5B8C5A', sort_order: 3 },
    { title: 'The Blackwood Estate Wedding', slug: 'blackwood-estate', category: 'weddings', location: 'Napa Valley, CA', description: 'Vineyard wedding with rustic elegance. Oak barrel décor, string lights, and a sunset ceremony among the vines.', date: '2023-10-07', featured: false, cover_color: '#7D5A50', sort_order: 4 },
    { title: 'Eliza & Marcus — A Rainy Day Love Story', slug: 'eliza-marcus-rain', category: 'weddings', location: 'Portland, Oregon', description: 'When it rained on their outdoor ceremony, they danced in it. Sometimes the most beautiful moments are unplanned.', date: '2024-03-16', client_type: null, featured: false, cover_color: '#5A6B7D', sort_order: 5 },

    // Portraits
    { title: 'Executive Portraits — Meridian Capital Partners', slug: 'meridian-executive', category: 'portraits', location: 'Financial District, San Francisco', description: 'Corporate headshots and environmental portraits for a boutique investment firm. Clean, confident, contemporary.', date: '2024-11-02', client_type: 'Corporate', featured: true, cover_color: '#2C3E50', sort_order: 6 },
    { title: 'Ava Chen — Artist Portfolio', slug: 'ava-chen-artist', category: 'portraits', location: 'Studio / SOMA, San Francisco', description: 'Creative portraits for a mixed-media artist. Shot in her studio surrounded by works in progress — paint-splattered and perfectly imperfect.', date: '2024-07-19', client_type: null, featured: false, cover_color: '#8E6B5A', sort_order: 7 },
    { title: 'Family Session — The Ramírez-O\'Brien Family', slug: 'ramirez-obrien-family', category: 'portraits', location: 'Baker Beach, San Francisco', description: 'Multigenerational family portraits at sunset. Three generations, two languages, one big beautiful mess of a family photo day.', date: '2024-04-28', client_type: 'Private', featured: false, cover_color: '#C4956A', sort_order: 8 },

    // Commercial
    { title: 'Artifact Coffee Roasters — Brand Campaign', slug: 'artifact-coffee', category: 'commercial', location: 'Mission District, San Francisco', description: 'Product and lifestyle photography for a specialty coffee brand. Shot on location at their roastery and three café locations over two days.', date: '2024-10-15', client_type: 'Commercial', featured: true, cover_color: '#5C4033', sort_order: 9 },
    { title: 'Kinfolk Magazine — West Coast Living Editorial', slug: 'kinfolk-west-coast', category: 'commercial', location: 'Various — San Francisco, Big Sur, Carmel-by-the-Sea', description: 'A multi-location editorial spread exploring West Coast living through interiors, landscapes, and quiet domestic moments.', date: '2024-05-20', client_type: 'Editorial / Commercial', featured: true, cover_color: '#A0937D', sort_order: 10 },
    { title: 'Lumina Skincare — Product Launch', slug: 'lumina-skincare', category: 'commercial', location: 'Studio', description: 'Clean, minimalist product photography for a luxury skincare line. Emphasis on texture, light, and the materiality of glass and botanical ingredients.', date: '2024-08-30', client_type: 'Commercial', featured: false, cover_color: '#D4C5B2', sort_order: 11 },

    // Editorial
    { title: 'Architectural Digest — The Painted Ladies Reimagined: A Modern Take on Victorian Living in San Francisco', slug: 'ad-painted-ladies', category: 'editorial', location: 'Alamo Square, San Francisco', description: 'Feature for AD on the interior redesign of one of the famous Painted Ladies. Modern minimalism meets Victorian architecture.', date: '2024-01-15', client_type: 'Editorial', featured: true, cover_color: '#9B8EC4', sort_order: 12 },
    { title: 'Elle Décor — Kitchen Stories', slug: 'elle-kitchen-stories', category: 'editorial', location: 'Pacific Heights, San Francisco', description: 'Interior photography for a feature on chef-designed home kitchens. Six homes, six stories, one obsession with good light.', date: '2023-11-20', client_type: 'Editorial', featured: false, cover_color: '#B8A088', sort_order: 13 },

    // Events
    { title: 'TechCrunch Disrupt — After Party', slug: 'tc-disrupt-party', category: 'events', location: 'Moscone Center, San Francisco', description: 'Event photography for the official TechCrunch Disrupt after party. 800+ guests, neon lights, and controlled chaos.', date: '2024-09-28', client_type: 'Corporate', featured: false, cover_color: '#1A1A2E', sort_order: 14 },
    { title: 'Marin County Arts Gala — Annual Benefit', slug: 'marin-arts-gala', category: 'events', location: 'The Headlands Center for the Arts, Sausalito', description: 'Black-tie benefit gala for the Marin County Arts Council. Auction, performances, and dinner overlooking the Golden Gate.', date: '2024-04-12', client_type: 'Non-profit', featured: false, cover_color: '#2D2D3D', sort_order: 15 },
    { title: 'startup mixer @PIER 39 (yes really)', slug: 'startup-mixer-pier39', category: 'events', location: 'PIER 39, Fishermans Wharf, SF', description: 'casual tech networking event. sea lions optional. the lighting was terrible but we made it work.', date: '2024-02-08', client_type: null, featured: false, cover_color: '#3D5A80', sort_order: 16 },
  ];

  for (const p of projects) {
    await prisma.project.create({ data: p });
  }
  console.log(`  Created ${projects.length} projects`);

  // ---- Services (packages) ----
  const services = [
    { name: 'Wedding Collection', starting_price: 'From $4,800', description: 'Full-day coverage of your wedding, from getting ready through the last dance. Two photographers, a private online gallery, and a minimum of 400 edited images.', includes: 'Full-day coverage (up to 10 hours) • Two photographers • 400+ edited images • Private online gallery • Engagement session • Timeline planning consultation', details: 'Additional hours available at $350/hr. Second-day coverage for multi-day celebrations available. Destination weddings welcome — travel fees quoted separately.', popular: true, sort_order: 1 },
    { name: 'Elopement & Intimate', starting_price: 'From $2,200', description: 'For couples who want it small, intentional, and beautiful. Up to 4 hours of coverage for ceremonies with under 30 guests.', includes: 'Up to 4 hours coverage • One photographer • 200+ edited images • Private gallery • Location scouting assistance', popular: false, sort_order: 2 },
    { name: 'Portrait Session', starting_price: 'From $650', description: 'Individual, couple, or family portraits. Studio or on-location. Includes styling guidance and a curated gallery of 30+ images.', includes: '1-hour session • 30+ edited images • Private gallery • Outfit/styling guidance • 1 location', popular: false, sort_order: 3 },
    { name: 'Corporate & Headshots', starting_price: 'From $1,200', description: 'Professional headshots and environmental portraits for teams of any size. On-location or in-studio with consistent, brand-aligned results.', includes: 'Half-day session (up to 4 hours) • Up to 15 individuals • 2 looks per person • Retouched finals • Brand color matching', details: 'Volume pricing available for teams over 25. Can accommodate office, studio, or outdoor locations.', popular: false, sort_order: 4 },
    { name: 'Brand & Commercial', starting_price: 'From $3,500', description: 'Product photography, lifestyle campaigns, and editorial content creation for brands. Full creative direction, shot lists, and post-production.', includes: 'Full-day shoot • Creative direction • Shot list planning • Product + lifestyle mix • High-res retouched files • Usage licensing (1 year)', details: 'Multi-day campaigns, ongoing retainer packages, and content subscriptions available. Contact for custom scope.', popular: true, sort_order: 5 },
    { name: 'Event Coverage', starting_price: 'From $1,800', description: 'Corporate events, galas, launch parties, and private celebrations. Fast turnaround, professional results, no flash disruption.', includes: 'Up to 5 hours coverage • One photographer • 150+ edited images • 48-hour preview delivery • Private gallery', popular: false, sort_order: 6 },
  ];

  for (const s of services) {
    await prisma.service.create({ data: s });
  }
  console.log(`  Created ${services.length} services`);

  // ---- Testimonials (intentionally varied length/quality) ----
  const testimonials = [
    { name: 'Sarah Anderson-Takahashi', role: 'Bride', text: 'Elena and her team captured our wedding in Tuscany with such grace and artistry. Every image tells a story — the light, the emotion, the tiny details we would have missed. When we opened our gallery, we cried. Not because the photos were pretty (they are), but because they felt exactly like the day felt. I cannot recommend Lumière highly enough.', rating: 5, event_type: 'wedding', project_id: 1, featured: true },
    { name: 'David Park', role: 'Groom', text: 'Best decision we made for our wedding. James made everyone feel comfortable and the photos are INCREDIBLE.', rating: 5, event_type: 'wedding', project_id: 3, featured: false },
    { name: 'Marcus Rivera', role: 'CEO, Meridian Capital', text: 'We needed headshots that felt modern and approachable without being casual. Elena understood exactly what we were after. The whole team was thrilled with the results — we use them everywhere now, from LinkedIn to investor decks.', rating: 5, event_type: 'portrait', project_id: 6, featured: true },
    { name: 'Jen Okafor', role: 'Marketing Director, Artifact Coffee', text: 'Working with Lumière on our brand campaign was seamless. They showed up with a clear vision, adapted on the fly when things got chaotic (our barista called in sick, it rained on the outdoor set), and delivered images that elevated our entire brand. The lifestyle shots are now on our packaging.', rating: 5, event_type: 'commercial', project_id: 9, featured: true },
    { name: 'Maya Nguyen', role: null, text: 'the elopement photos are so beautiful i literally cant stop looking at them. elena you are a magician', rating: 5, event_type: 'wedding', featured: false },
    { name: 'Ava Chen', role: 'Artist', text: 'Elena photographed me in my studio surrounded by half-finished canvases and spilled turpentine. Instead of making it look messy, she made it look like art. Which I guess is the whole point. The portraits capture something about how I work that I have never been able to articulate myself. Genuinely transformative experience — I use these images for everything now, from gallery submissions to my website to grant applications. Worth every penny and then some.', rating: 5, event_type: 'portrait', project_id: 7, featured: true },
    { name: 'Tom Blackwood', role: 'Father of the Bride', text: 'Hired Lumière for my daughter\'s wedding. Professional, unobtrusive, and the photos are beautiful. Money well spent.', rating: 4, event_type: 'wedding', project_id: 4, featured: false },
    { name: 'Rachel Kim', role: 'Events Coordinator, TechCrunch', text: 'Fast turnaround, great eye for candid moments. Will book again.', rating: 4, event_type: 'event', project_id: 14, featured: false },
    { name: 'Dr. Patricia Ramírez', role: 'Grandmother', text: 'This was our first professional family photo in over fifteen years. Elena made our grandchildren laugh, got our teenage grandson to actually smile (a miracle), and captured a moment with all three generations that I will treasure forever. The portrait is already framed and hanging in our living room.', rating: 5, event_type: 'portrait', project_id: 8, featured: true },
    { name: 'Kinfolk Magazine (Editorial Team)', role: 'Publications', text: 'Lumière consistently delivers editorial-quality work. Their eye for composition and natural light is exceptional. We have featured their work three times and each collaboration has been effortless.', rating: 5, event_type: 'editorial', featured: true },
    { name: 'amanda r.', role: null, text: 'honestly was skeptical about the price but WOW the results speak for themselves. my linkedin headshot gets compliments constantly lol', rating: 5, event_type: 'portrait', featured: false },
    { name: 'Michael & Chris O\'Brien', role: 'Couple', text: 'Our family session at Baker Beach was perfect despite the wind and our toddler\'s meltdown. James somehow got shots of all of us looking happy AT THE SAME TIME. Wizard.', rating: 5, event_type: 'portrait', project_id: 8, featured: false },
  ];

  for (const t of testimonials) {
    await prisma.testimonial.create({ data: t });
  }
  console.log(`  Created ${testimonials.length} testimonials`);

  // ---- FAQs ----
  const faqs = [
    { question: 'How far in advance should I book?', answer: 'For weddings, we recommend booking 8-12 months in advance, especially for peak season (May-October). Portrait sessions and commercial projects can often be scheduled within 2-4 weeks. For destination work, give us as much lead time as possible so we can coordinate travel logistics.', category: 'booking', sort_order: 1 },
    { question: 'Do you travel for destination weddings and projects?', answer: 'Absolutely. We love destination work and have photographed weddings and projects across Italy, France, Mexico, Hawaii, and throughout the US. Travel fees are quoted based on location and duration — typically covering flights, accommodation, and a per diem. For West Coast locations (California, Oregon, Washington), there is no additional travel fee.', category: 'booking', sort_order: 2 },
    { question: 'What is your pricing structure?', answer: 'Our pricing is based on the type of project, duration, and deliverables. Wedding collections start at $4,800, portrait sessions from $650, and commercial projects from $3,500. We provide detailed custom quotes after an initial consultation so we can tailor the scope to your needs and budget.', category: 'pricing', sort_order: 3 },
    { question: 'Do you offer payment plans?', answer: 'Yes. For wedding and commercial projects over $3,000, we offer a three-payment plan: 30% retainer at booking, 40% one month before the event, and the remaining 30% upon gallery delivery. We accept credit cards, bank transfers, and Venmo.', category: 'pricing', sort_order: 4 },
    { question: 'How long until we receive our photos?', answer: 'Wedding galleries are delivered within 4-6 weeks. Portrait sessions within 1-2 weeks. Commercial projects on a timeline agreed upon in the contract — typically 2-3 weeks for standard projects. Rush delivery is available for an additional fee.', category: 'process', sort_order: 5 },
    { question: 'Do you provide raw/unedited files?', answer: 'We do not provide raw files. Every image we deliver is individually edited and color-graded to our signature style. This ensures a cohesive, polished final product. If you need specific crops or adjustments, we are happy to accommodate.', category: 'process', sort_order: 6 },
    { question: 'What happens if it rains on our wedding day?', answer: 'Rain makes for some of the most dramatic, beautiful photographs. We come prepared with creative solutions and have shot stunning weddings in every weather condition. Some of our most beloved images were taken in the rain. Trust the process — and pack a cute umbrella.', category: 'general', sort_order: 7 },
    { question: 'Can we get a second photographer?', answer: 'All wedding collections include two photographers. For portrait sessions and events, a second photographer can be added for $150/hour. For commercial projects, additional photographers are quoted based on scope.', category: 'pricing', sort_order: 8 },
    { question: 'What should I wear to my portrait session?', answer: 'We provide a detailed styling guide after booking. In general: solid colors photograph better than busy patterns, layers add visual interest, and coordinating (not matching) outfits work best for couples and families. Avoid logos, neon colors, and brand-new shoes that hurt.', category: 'process', sort_order: 9 },
    { question: 'Do you do videography or just photography?', answer: 'We specialize exclusively in photography. However, we work regularly with several videography partners and are happy to recommend someone who matches your style and budget. Having worked together before means seamless coordination on the day.', category: 'general', sort_order: 10 },
  ];

  for (const f of faqs) {
    await prisma.faq.create({ data: f });
  }
  console.log(`  Created ${faqs.length} FAQs`);

  // ---- Inquiries (messy, realistic pipeline data) ----
  const inquiries = [
    { name: 'Jessica & Tom Whitfield', email: 'jess.whitfield@gmail.com', phone: '(415) 555-0142', event_type: 'wedding', event_date: '2025-06-14', location: 'Napa Valley, CA — vineyard TBD', budget: '$6,000-8,000', guest_count: 120, referral_source: 'Instagram', message: 'Hi! We saw your Tuscany wedding on Instagram and DIED. We are getting married at a vineyard in Napa in June and would love to chat about availability. Our budget is flexible.', status: 'proposal_sent', created_at: new Date('2025-01-15T10:23:00Z') },
    { name: 'Robert Chen', email: 'rchen@meridiancp.com', phone: '415.555.0199', event_type: 'portrait', event_date: '2025-03-10', location: 'Financial District, San Francisco', budget: '$2,500', referral_source: 'Previous client (Marcus Rivera)', message: 'Marcus recommended you for our updated team headshots. We have 8 people. Ideally mid-March.', status: 'qualified', created_at: new Date('2025-02-01T14:45:00Z') },
    { name: 'Priya Sharma', email: 'priya.s@outlook.com', phone: '+1 (650) 555-0177', event_type: 'wedding', event_date: '2025-10-18', location: 'Half Moon Bay, Ritz-Carlton', budget: '$7,000-10,000', guest_count: 200, referral_source: 'The Knot', message: 'Looking for a photographer for our October wedding at the Ritz-Carlton Half Moon Bay. We want a mix of traditional and candid photography. Our families are large (200 guests) so we need someone who can handle group shots efficiently. Indian/American fusion ceremony.', status: 'contacted', created_at: new Date('2025-01-28T09:12:00Z') },
    { name: 'BLANK SLATE COFFEE CO.', email: 'hello@blankslatecoffee.com', phone: null, event_type: 'commercial', event_date: null, location: 'Hayes Valley, SF + 2 additional locations', budget: '5k-7k range', referral_source: 'Saw Artifact Coffee photos on your site', message: 'we are launching a new line of cold brews and need lifestyle/product photography. similar vibe to what you did for Artifact but more playful/colorful. can you send your full commercial rate card?', status: 'new', created_at: new Date('2025-02-20T16:30:00Z') },
    { name: 'Maria Santos', email: 'msantos_photo@yahoo.com', phone: '(510) 555-0188', event_type: 'portrait', event_date: '2025-04-05', location: 'Berkeley Hills or Tilden Park', budget: 'under $1000 if possible', referral_source: 'Google', message: 'I need family portraits for my parents 50th anniversary. 15 people total including young kids. Would love outdoor setting.', status: 'contacted', created_at: new Date('2025-02-10T11:20:00Z') },
    { name: 'Tech Innovators Summit 2025', email: 'events@techinnovators.io', phone: '1-800-555-0134', event_type: 'event', event_date: '2025-05-22', location: 'The Moscone Center, San Francisco, CA 94103', budget: '$3,000', guest_count: 500, referral_source: 'Industry referral', message: 'Annual tech conference, need coverage for keynotes, expo floor, networking events. Approximately 8 hours.', status: 'booked', created_at: new Date('2025-01-05T08:00:00Z') },
    { name: 'anonymous', email: 'test@test.com', phone: null, event_type: 'other', event_date: null, location: null, budget: null, referral_source: null, message: 'just testing your form', status: 'closed_lost', created_at: new Date('2025-02-18T03:45:00Z') },
    { name: 'Lauren & Alex DeSantis', email: 'laurenalex2025@gmail.com', phone: '925-555-0166', event_type: 'wedding', event_date: '2025-12-20', location: 'San Francisco City Hall + reception at The Pearl (SOMA)', budget: '$5,000-6,000', guest_count: 80, referral_source: 'Friend recommendation', message: 'Winter wedding at SF City Hall! Ceremony in the rotunda then reception at The Pearl. Would love a photographer who knows City Hall well and can work with the sometimes challenging indoor light.', status: 'qualified', created_at: new Date('2025-02-08T13:15:00Z') },
    { name: 'jonathan k', email: 'jkaufman@startup.co', phone: '(415) 555-0211', event_type: 'portrait', event_date: '2025-03-01', location: 'our office in SOMA', budget: 'what are your rates?', referral_source: 'LinkedIn', message: 'need headshots for our founding team (4 people) for website and press kit. startup vibes — not too corporate. can you do something creative?', status: 'new', created_at: new Date('2025-02-22T10:00:00Z') },
    { name: 'Adrienne Beaumont', email: 'adrienne@abinteriors.com', phone: '+1-415-555-0200', event_type: 'editorial', event_date: '2025-04-15', location: 'Pacific Heights residence — exact address TBD upon booking', budget: '$4,500-6,000', referral_source: 'Architectural Digest', message: 'Interior designer here. Finishing a large residential project in Pacific Heights and need architectural/interior photography for my portfolio and potential publication. Are you available mid-April? Happy to discuss scope in more detail on a call.', status: 'proposal_sent', created_at: new Date('2025-02-05T15:30:00Z') },
    { name: 'The Mendoza Family', email: 'carmenmendoza@icloud.com', phone: '650 555 0143', event_type: 'portrait', event_date: '2025-05-10', location: 'Golden Gate Park or wherever you recommend honestly', budget: '$700-900', guest_count: 8, referral_source: 'Yelp', message: 'Hi! Looking for a photographer for our annual family portraits. We have 4 kids ages 3-12 (yes its chaos). Need someone patient and good with kids!', status: 'new', created_at: new Date('2025-02-23T18:45:00Z') },
    { name: 'VOGUE WEDDINGS - SUBMISSIONS', email: 'submissions@vogue.com', phone: null, event_type: 'editorial', event_date: null, location: null, budget: null, referral_source: 'Publication inquiry', message: 'We are curating our Spring 2025 real weddings feature and are interested in your Anderson-Takahashi Tuscany wedding for consideration. Please submit the full gallery at your earliest convenience via our editorial portal.', status: 'contacted', created_at: new Date('2025-02-15T09:00:00Z') },
  ];

  for (const inq of inquiries) {
    await prisma.inquiry.create({ data: inq });
  }
  console.log(`  Created ${inquiries.length} inquiries`);

  // ---- Summary ----
  const totalRecords = users.length + projects.length + services.length + testimonials.length + faqs.length + inquiries.length;
  console.log(`\nDone! ${totalRecords} total records seeded.`);
  console.log('\nLogin credentials:');
  console.log('  admin:   elena@lumiere.studio / admin123');
  console.log('  manager: james@lumiere.studio / studio123');
  console.log('  editor:  sofia@lumiere.studio / editor123');
}

main()
  .catch((e) => { console.error('Seed failed:', e); process.exit(1); })
  .finally(() => prisma.$disconnect());
