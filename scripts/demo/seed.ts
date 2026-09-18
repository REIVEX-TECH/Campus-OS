import { createHash } from 'node:crypto';
import type { Sql } from 'postgres';
import { tenantConfigSchema } from '@campusos/core/tenant';
import { demo } from '@campusos/tenants';

/**
 * Seed the `demo` tenant with realistic, illustrative content across every enabled
 * module. Owner-run (the caller passes an owner `Sql`), idempotent (deterministic ids
 * + ON CONFLICT DO NOTHING), and scoped to `demo` only. Content is inserted directly
 * (end-state rows) rather than through the module APIs; that is the seed's job, not
 * the verified-gate/contact-scrub the live paths enforce.
 *
 * FORCE tables (timetable, communities posts/comments, lost-found, marketplace
 * listings/gigs/reviews) require the owner to set app.tenant_id (+ app.user_id for
 * insert-as-self) so their WITH CHECK passes; NO FORCE tables (users, memberships,
 * orders, messages, rides, votes) accept owner writes directly. See
 * docs/design-demo-tenant.md.
 */

export const DEMO_SLUG = 'demo';

/** Deterministic uuid from a stable key, so re-running the seed is idempotent. */
export function uid(key: string): string {
  const h = createHash('md5').update(`demo:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

interface Persona {
  key: string;
  name: string;
  handle: string;
  role: 'student' | 'teacher' | 'tenant_admin';
}

export const PERSONAS: Persona[] = [
  { key: 'ayesha', name: 'Ayesha Khan', handle: 'AyeshaK_2041', role: 'student' },
  { key: 'bilal', name: 'Bilal Ahmed', handle: 'BilalA_7788', role: 'student' },
  { key: 'chloe', name: 'Chloe Martin', handle: 'ChloeM_3390', role: 'student' },
  { key: 'danish', name: 'Danish Raza', handle: 'DanishR_5521', role: 'student' },
  { key: 'esha', name: 'Esha Malik', handle: 'EshaM_1204', role: 'student' },
  { key: 'farhan', name: 'Farhan Sheikh', handle: 'FarhanS_9012', role: 'student' },
  { key: 'khan', name: 'Prof. Imran Khan', handle: 'ProfKhan_0071', role: 'teacher' },
  { key: 'admin', name: 'Demo Administrator', handle: 'DemoAdmin_0001', role: 'tenant_admin' },
];

function personaId(key: string): string {
  return uid(`user:${key}`);
}

/** Run `fn` with app.user_id set to `userId` (session-scoped on the single owner
 * connection), for the insert-as-self policies on the FORCE content tables. */
async function asUser(sql: Sql, userId: string, fn: () => Promise<void>): Promise<void> {
  await sql`select set_config('app.user_id', ${userId}, false)`;
  await fn();
  await sql`select set_config('app.user_id', '', false)`;
}

export async function seedDemo(sql: Sql): Promise<void> {
  // 1. Tenant anchor + config (carries the banner G) + system roles. Self-contained
  // so `pnpm demo:seed` sets up the tenant end to end.
  const config = tenantConfigSchema.parse(demo);
  await sql`
    insert into universities (slug, name, timezone, locale)
    values (${config.slug}, ${config.displayName}, ${config.timezone}, ${config.locale})
    on conflict (slug) do update set name = excluded.name, timezone = excluded.timezone,
      locale = excluded.locale, updated_at = now()`;
  await sql`
    insert into tenant_configs (slug, config)
    values (${config.slug}, ${sql.json(config)})
    on conflict (slug) do update set config = excluded.config,
      version = tenant_configs.version + 1, updated_at = now(), updated_by = null`;
  await sql`select auth_sync_tenant_roles(${DEMO_SLUG})`;

  // Every content insert is for the demo tenant.
  await sql`select set_config('app.tenant_id', ${DEMO_SLUG}, false)`;

  // 2. Personas (users are NO FORCE; the owner sets is_demo directly) + verified
  // memberships (NO FORCE).
  for (const p of PERSONAS) {
    const id = personaId(p.key);
    await sql`
      insert into users (id, google_sub, email, email_verified_at, handle, avatar_seed, is_demo)
      values (${id}, ${`demo-persona-${p.key}`}, ${`${p.key}@demo.campusos.reivex.io`},
              now(), ${p.handle}, ${id}, true)
      on conflict (id) do nothing`;
    await sql`
      insert into tenant_memberships (tenant_id, user_id, role, status, verified_at, verification_method)
      values (${DEMO_SLUG}, ${id}, ${p.role}, 'active', now(), 'admin')
      on conflict (tenant_id, user_id) do nothing`;
  }

  await seedTimetable(sql);
  await seedCommunities(sql);
  await seedLostFound(sql);
  await seedMarketplace(sql);
  await seedMessages(sql);
  await seedRides(sql);

  await sql`select set_config('app.tenant_id', '', false)`;
}

async function seedTimetable(sql: Sql): Promise<void> {
  const campus = uid('campus:main');
  const sci = uid('bld:sci');
  const arts = uid('bld:arts');
  const term = uid('term:fa26');
  const dept = uid('dept:cs');
  const prog = uid('prog:bscs');
  await sql`insert into campuses (id, tenant_id, name) values (${campus}, ${DEMO_SLUG}, 'Main Campus') on conflict (id) do nothing`;
  await sql`insert into buildings (id, tenant_id, campus_id, name, code) values
      (${sci}, ${DEMO_SLUG}, ${campus}, 'Science Block', 'SCI'),
      (${arts}, ${DEMO_SLUG}, ${campus}, 'Arts Block', 'ART') on conflict (id) do nothing`;
  const rooms = [
    { key: 'sci-101', b: sci, name: 'SCI-101' },
    { key: 'sci-102', b: sci, name: 'SCI-102' },
    { key: 'art-201', b: arts, name: 'ART-201' },
  ];
  for (const r of rooms) {
    await sql`insert into rooms (id, tenant_id, building_id, name, dedup_key, capacity)
      values (${uid(`room:${r.key}`)}, ${DEMO_SLUG}, ${r.b}, ${r.name}, ${r.key}, 40)
      on conflict (tenant_id, dedup_key) where deleted_at is null do nothing`;
  }
  await sql`insert into academic_terms (id, tenant_id, name, code) values (${term}, ${DEMO_SLUG}, 'Fall 2026', 'FA26') on conflict (tenant_id, code) do nothing`;
  await sql`insert into departments (id, tenant_id, name, code) values (${dept}, ${DEMO_SLUG}, 'Computer Science', 'CS') on conflict (tenant_id, code) do nothing`;
  await sql`insert into programs (id, tenant_id, department_id, name, code, degree_level) values (${prog}, ${DEMO_SLUG}, ${dept}, 'BS Computer Science', 'BSCS', 'bachelor') on conflict (tenant_id, code) do nothing`;

  const courses = [
    { code: 'CS101', title: 'Introduction to Programming', ch: 3 },
    { code: 'CS201', title: 'Data Structures', ch: 4 },
    { code: 'CS301', title: 'Databases', ch: 3 },
    { code: 'MATH101', title: 'Calculus I', ch: 3 },
  ];
  for (const c of courses) {
    await sql`insert into courses (id, tenant_id, department_id, code, title, credit_hours)
      values (${uid(`course:${c.code}`)}, ${DEMO_SLUG}, ${dept}, ${c.code}, ${c.title}, ${c.ch})
      on conflict (tenant_id, code) do nothing`;
  }
  const teachers = [
    { key: 'khan', name: 'Prof. Imran Khan', title: 'Associate Professor' },
    { key: 'lena', name: 'Dr. Lena Farooq', title: 'Assistant Professor' },
  ];
  for (const t of teachers) {
    await sql`insert into teachers (id, tenant_id, department_id, name, title, employee_code)
      values (${uid(`teacher:${t.key}`)}, ${DEMO_SLUG}, ${dept}, ${t.name}, ${t.title}, ${t.key.toUpperCase()})
      on conflict (id) do nothing`;
  }
  const sections = [
    { key: 'bscs-1a', name: 'BSCS-1A' },
    { key: 'bscs-2a', name: 'BSCS-2A' },
  ];
  for (const s of sections) {
    await sql`insert into sections (id, tenant_id, program_id, term_id, name, semester)
      values (${uid(`section:${s.key}`)}, ${DEMO_SLUG}, ${prog}, ${term}, ${s.name}, 1)
      on conflict (id) do nothing`;
  }
  // Weekly meetings: (section, course, teacher, room, ISO day, time, kind).
  const entries = [
    {
      sec: 'bscs-1a',
      course: 'CS101',
      teacher: 'khan',
      room: 'sci-101',
      day: 1,
      from: '09:00',
      to: '10:30',
      kind: 'lecture',
    },
    {
      sec: 'bscs-1a',
      course: 'CS101',
      teacher: 'khan',
      room: 'sci-102',
      day: 3,
      from: '09:00',
      to: '11:00',
      kind: 'lab',
    },
    {
      sec: 'bscs-1a',
      course: 'MATH101',
      teacher: 'lena',
      room: 'art-201',
      day: 2,
      from: '11:00',
      to: '12:30',
      kind: 'lecture',
    },
    {
      sec: 'bscs-2a',
      course: 'CS201',
      teacher: 'khan',
      room: 'sci-101',
      day: 1,
      from: '11:00',
      to: '12:30',
      kind: 'lecture',
    },
    {
      sec: 'bscs-2a',
      course: 'CS201',
      teacher: 'khan',
      room: 'sci-102',
      day: 4,
      from: '14:00',
      to: '16:00',
      kind: 'lab',
    },
    {
      sec: 'bscs-2a',
      course: 'CS301',
      teacher: 'lena',
      room: 'art-201',
      day: 5,
      from: '10:00',
      to: '11:30',
      kind: 'lecture',
    },
  ];
  for (const e of entries) {
    const hash = createHash('md5')
      .update(`demo:tt:${e.sec}:${e.course}:${e.day}:${e.from}`)
      .digest('hex');
    await sql`insert into timetable_entries
      (id, tenant_id, term_id, section_id, course_id, teacher_id, room_id, day_of_week, starts_at, ends_at, kind, content_hash)
      values (${uid(`tt:${hash}`)}, ${DEMO_SLUG}, ${term}, ${uid(`section:${e.sec}`)}, ${uid(`course:${e.course}`)},
              ${uid(`teacher:${e.teacher}`)}, ${uid(`room:${e.room}`)}, ${e.day}, ${e.from}, ${e.to}, ${e.kind}, ${hash})
      on conflict (tenant_id, content_hash) where valid_to is null do nothing`;
  }
}

async function seedCommunities(sql: Sql): Promise<void> {
  const communities = [
    {
      key: 'cs',
      slug: 'cs-students',
      name: 'CS Students',
      desc: 'Everything Computer Science at the demo campus.',
      by: 'ayesha',
    },
    {
      key: 'life',
      slug: 'campus-life',
      name: 'Campus Life',
      desc: 'Events, food, and everything in between.',
      by: 'chloe',
    },
  ];
  for (const c of communities) {
    await sql`insert into communities (id, tenant_id, slug, name, description, icon_seed, banner_seed, created_by)
      values (${uid(`comm:${c.key}`)}, ${DEMO_SLUG}, ${c.slug}, ${c.name}, ${c.desc},
              ${uid(`comm:icon:${c.key}`)}, ${uid(`comm:banner:${c.key}`)}, ${personaId(c.by)})
      on conflict (tenant_id, slug) do nothing`;
  }
  const posts = [
    {
      key: 'p1',
      comm: 'cs',
      by: 'bilal',
      title: 'Best resources for Data Structures?',
      body: 'Starting CS201 this term, any recommended books or channels?',
    },
    {
      key: 'p2',
      comm: 'cs',
      by: 'ayesha',
      title: 'Study group for CS101',
      body: 'Forming a weekly study group in the Science Block. Reply if interested.',
    },
    {
      key: 'p3',
      comm: 'cs',
      by: 'danish',
      title: 'Databases project ideas',
      body: 'What did people build for the CS301 project last year?',
    },
    {
      key: 'p4',
      comm: 'life',
      by: 'chloe',
      title: 'Best chai on campus',
      body: 'The Arts Block canteen is underrated. Change my mind.',
    },
    {
      key: 'p5',
      comm: 'life',
      by: 'esha',
      title: 'Lost and found near the library',
      body: 'Reminder to check the lost and found board by the main library.',
    },
  ];
  for (const p of posts) {
    await asUser(sql, personaId(p.by), async () => {
      await sql`insert into posts (id, tenant_id, community_id, author_id, kind, title, body)
        values (${uid(`post:${p.key}`)}, ${DEMO_SLUG}, ${uid(`comm:${p.comm}`)}, ${personaId(p.by)}, 'text', ${p.title}, ${p.body})
        on conflict (id) do nothing`;
    });
  }
  const comments = [
    {
      key: 'c1',
      post: 'p1',
      by: 'ayesha',
      body: 'The open data structures book is a great free start.',
    },
    {
      key: 'c2',
      post: 'p1',
      by: 'danish',
      body: 'Do the practice problems, not just the reading.',
    },
    { key: 'c3', post: 'p2', by: 'farhan', body: 'Count me in for the study group.' },
    {
      key: 'c4',
      post: 'p3',
      by: 'bilal',
      body: 'A small library catalogue app is a solid, scoped project.',
    },
    { key: 'c5', post: 'p4', by: 'esha', body: 'Agreed, and the samosas are the real draw.' },
  ];
  for (const c of comments) {
    await asUser(sql, personaId(c.by), async () => {
      await sql`insert into comments (id, tenant_id, post_id, path, author_id, body)
        values (${uid(`comment:${c.key}`)}, ${DEMO_SLUG}, ${uid(`post:${c.post}`)}, ${uid(`comment:${c.key}`)}, ${personaId(c.by)}, ${c.body})
        on conflict (id) do nothing`;
    });
  }
  // A few votes (NO FORCE) + karma so profiles read realistically.
  const votes = [
    { post: 'p1', by: 'chloe' },
    { post: 'p1', by: 'esha' },
    { post: 'p2', by: 'danish' },
    { post: 'p4', by: 'ayesha' },
  ];
  for (const v of votes) {
    await sql`insert into post_votes (tenant_id, post_id, user_id, value)
      values (${DEMO_SLUG}, ${uid(`post:${v.post}`)}, ${personaId(v.by)}, 1)
      on conflict (post_id, user_id) do nothing`;
  }
  for (const p of PERSONAS) {
    await sql`insert into community_karma (tenant_id, user_id, post_karma, comment_karma, public_post_karma, public_comment_karma)
      values (${DEMO_SLUG}, ${personaId(p.key)}, 3, 2, 3, 2)
      on conflict (tenant_id, user_id) do nothing`;
  }
}

async function seedLostFound(sql: Sql): Promise<void> {
  const items = [
    {
      key: 'i1',
      by: 'ayesha',
      kind: 'lost',
      title: 'Blue water bottle',
      cat: 'other',
      loc: 'Science Block, near SCI-101',
      status: 'open',
    },
    {
      key: 'i2',
      by: 'bilal',
      kind: 'found',
      title: 'Student ID card',
      cat: 'cards',
      loc: 'Main library entrance',
      status: 'open',
    },
    {
      key: 'i3',
      by: 'chloe',
      kind: 'lost',
      title: 'Scientific calculator',
      cat: 'electronics',
      loc: 'Arts Block canteen',
      status: 'resolved',
    },
    {
      key: 'i4',
      by: 'danish',
      kind: 'found',
      title: 'Set of keys',
      cat: 'keys',
      loc: 'Parking lot B',
      status: 'open',
    },
  ];
  for (const it of items) {
    await asUser(sql, personaId(it.by), async () => {
      await sql`insert into lf_items (id, tenant_id, reporter_id, kind, title, description, category, location_text, status)
        values (${uid(`lf:${it.key}`)}, ${DEMO_SLUG}, ${personaId(it.by)}, ${it.kind}, ${it.title},
                'Illustrative demo item.', ${it.cat}, ${it.loc}, ${it.status})
        on conflict (id) do nothing`;
    });
  }
}

async function seedMarketplace(sql: Sql): Promise<void> {
  const listings = [
    {
      key: 'l1',
      by: 'ayesha',
      title: 'Data Structures textbook (used)',
      price: 120000,
      cat: 'books',
      cond: 'good',
    },
    {
      key: 'l2',
      by: 'bilal',
      title: 'Scientific calculator',
      price: 250000,
      cat: 'electronics',
      cond: 'like_new',
    },
    { key: 'l3', by: 'chloe', title: 'Desk lamp', price: 90000, cat: 'home', cond: 'good' },
    { key: 'l4', by: 'danish', title: 'Bicycle', price: 1500000, cat: 'other', cond: 'fair' },
    {
      key: 'l5',
      by: 'esha',
      title: 'Lab coat (size M)',
      price: 80000,
      cat: 'other',
      cond: 'like_new',
    },
  ];
  for (const l of listings) {
    await asUser(sql, personaId(l.by), async () => {
      await sql`insert into mkt_listings (id, tenant_id, seller_id, title, description, price_paisa, category, condition)
        values (${uid(`listing:${l.key}`)}, ${DEMO_SLUG}, ${personaId(l.by)}, ${l.title}, 'Illustrative demo listing.',
                ${l.price}, ${l.cat}, ${l.cond})
        on conflict (id) do nothing`;
    });
  }
  // A gig + packages (seller = farhan), then a completed order (buyer = ayesha) and a
  // review. The review's RLS requires app.user_id = buyer AND a completed order to
  // already exist (mkt_orders is NO FORCE, so the owner inserts it directly).
  const gig = uid('gig:cv');
  const seller = personaId('farhan');
  const pkgBasic = uid('gigpkg:cv:basic');
  await asUser(sql, seller, async () => {
    await sql`insert into mkt_gigs (id, tenant_id, seller_id, title, description, category)
      values (${gig}, ${DEMO_SLUG}, ${seller}, 'CV and resume design', 'A clean, one-page CV tailored to you.', 'design')
      on conflict (id) do nothing`;
    await sql`insert into mkt_gig_packages (id, tenant_id, gig_id, tier, title, description, price_paisa, delivery_days, revisions, position)
      values
        (${pkgBasic}, ${DEMO_SLUG}, ${gig}, 'basic', 'Basic', 'One-page CV, one revision.', 200000, 3, 1, 0),
        (${uid('gigpkg:cv:standard')}, ${DEMO_SLUG}, ${gig}, 'standard', 'Standard', 'CV plus cover letter.', 350000, 5, 2, 1)
      on conflict (gig_id, tier) do nothing`;
  });
  const buyer = personaId('ayesha');
  const order = uid('order:cv:ayesha');
  // Completed order (NO FORCE table; owner inserts directly).
  await sql`insert into mkt_orders
    (id, tenant_id, gig_id, package_id, buyer_id, seller_id, title, price_paisa, delivery_days, payment_mode, status, completed_at)
    values (${order}, ${DEMO_SLUG}, ${gig}, ${pkgBasic}, ${buyer}, ${seller}, 'Basic', 200000, 3, 'cash', 'completed', now())
    on conflict (id) do nothing`;
  await asUser(sql, buyer, async () => {
    await sql`insert into mkt_reviews (id, tenant_id, order_id, gig_id, reviewer_id, seller_id, rating, body)
      values (${uid('review:cv:ayesha')}, ${DEMO_SLUG}, ${order}, ${gig}, ${buyer}, ${seller}, 5, 'Fast and professional. Recommended.')
      on conflict (order_id) do nothing`;
  });
}

async function seedMessages(sql: Sql): Promise<void> {
  const threads = [
    {
      key: 't1',
      a: 'ayesha',
      b: 'bilal',
      msgs: [
        { by: 'ayesha', body: 'Hey, is the Data Structures book still available?' },
        { by: 'bilal', body: 'Yes it is. Free to meet at the Science Block tomorrow?' },
        { by: 'ayesha', body: 'Perfect, see you at 11.' },
      ],
    },
    {
      key: 't2',
      a: 'chloe',
      b: 'danish',
      msgs: [
        { by: 'danish', body: 'Are you going to the databases talk on Friday?' },
        { by: 'chloe', body: 'Planning to. Save me a seat.' },
      ],
    },
  ];
  for (const t of threads) {
    const idA = personaId(t.a);
    const idB = personaId(t.b);
    const [pa, pb] = idA < idB ? [idA, idB] : [idB, idA];
    const conv = uid(`conv:${t.key}`);
    await sql`insert into msg_conversations (id, tenant_id, participant_a, participant_b, status, last_message_at)
      values (${conv}, ${DEMO_SLUG}, ${pa}, ${pb}, 'active', now())
      on conflict (tenant_id, participant_a, participant_b) do nothing`;
    let n = 0;
    for (const m of t.msgs) {
      await sql`insert into msg_messages (id, tenant_id, conversation_id, sender_id, body)
        values (${uid(`msg:${t.key}:${n}`)}, ${DEMO_SLUG}, ${conv}, ${personaId(m.by)}, ${m.body})
        on conflict (id) do nothing`;
      n += 1;
    }
  }
}

async function seedRides(sql: Sql): Promise<void> {
  const posts = [
    {
      key: 'r1',
      by: 'ayesha',
      kind: 'offer',
      from: 'DHA Phase 5',
      to: 'Main Campus',
      inDays: 1,
      seats: 3,
    },
    {
      key: 'r2',
      by: 'bilal',
      kind: 'offer',
      from: 'Johar Town',
      to: 'Main Campus',
      inDays: 2,
      seats: 2,
    },
    {
      key: 'r3',
      by: 'chloe',
      kind: 'request',
      from: 'Model Town',
      to: 'Main Campus',
      inDays: 1,
      seats: null,
    },
  ];
  for (const r of posts) {
    const isOffer = r.kind === 'offer';
    await sql`insert into ride_posts
      (id, tenant_id, author_id, kind, origin_text, dest_text, depart_at, seats_total, seats_available, notes, status)
      values (${uid(`ride:${r.key}`)}, ${DEMO_SLUG}, ${personaId(r.by)}, ${r.kind}, ${r.from}, ${r.to},
              now() + (${r.inDays} * interval '1 day'), ${isOffer ? r.seats : null}, ${isOffer ? r.seats : null},
              'Illustrative demo ride. Cost is between riders.', 'active')
      on conflict (id) do nothing`;
  }
  // An accepted seat on ayesha's offer, by danish.
  await sql`insert into ride_seat_requests (id, tenant_id, ride_post_id, passenger_id, seats, status, decided_at)
    values (${uid('seat:r1:danish')}, ${DEMO_SLUG}, ${uid('ride:r1')}, ${personaId('danish')}, 1, 'accepted', now())
    on conflict (ride_post_id, passenger_id) where status in ('pending','accepted') do nothing`;
  // A rating danish left for the driver on a (conceptually completed) trip.
  await sql`insert into ride_ratings (id, tenant_id, ride_post_id, rater_id, ratee_id, direction, stars, comment)
    values (${uid('rating:r1:danish')}, ${DEMO_SLUG}, ${uid('ride:r1')}, ${personaId('danish')}, ${personaId('ayesha')},
            'of_driver', 5, 'On time and friendly.')
    on conflict (ride_post_id, rater_id, ratee_id) do nothing`;
}
