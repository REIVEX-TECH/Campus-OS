import { date, index, integer, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { recordStatus } from './enums';
import { softDelete, tenantId, timestamps } from './_shared';

export const academicTerms = pgTable(
  'academic_terms',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex('academic_terms_tenant_code_uq').on(t.tenantId, t.code)],
);

export const departments = pgTable(
  'departments',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    name: text('name').notNull(),
    code: text('code').notNull(),
    ...timestamps,
    ...softDelete,
  },
  (t) => [uniqueIndex('departments_tenant_code_uq').on(t.tenantId, t.code)],
);

export const programs = pgTable(
  'programs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    departmentId: uuid('department_id')
      .notNull()
      .references(() => departments.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    code: text('code').notNull(),
    degreeLevel: text('degree_level'),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('programs_tenant_code_uq').on(t.tenantId, t.code),
    index('programs_tenant_department_idx').on(t.tenantId, t.departmentId),
  ],
);

export const courses = pgTable(
  'courses',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    code: text('code').notNull(),
    title: text('title').notNull(),
    creditHours: integer('credit_hours'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    uniqueIndex('courses_tenant_code_uq').on(t.tenantId, t.code),
    index('courses_tenant_department_idx').on(t.tenantId, t.departmentId),
  ],
);

export const teachers = pgTable(
  'teachers',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    departmentId: uuid('department_id').references(() => departments.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    title: text('title'),
    employeeCode: text('employee_code'),
    // Minimal PII: email is optional and only stored when the source provides it.
    email: text('email'),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [index('teachers_tenant_department_idx').on(t.tenantId, t.departmentId)],
);

export const sections = pgTable(
  'sections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    tenantId: tenantId(),
    programId: uuid('program_id')
      .notNull()
      .references(() => programs.id, { onDelete: 'cascade' }),
    termId: uuid('term_id')
      .notNull()
      .references(() => academicTerms.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    semester: integer('semester'),
    status: recordStatus('status').notNull().default('active'),
    ...timestamps,
    ...softDelete,
  },
  (t) => [
    index('sections_tenant_term_idx').on(t.tenantId, t.termId),
    index('sections_tenant_program_idx').on(t.tenantId, t.programId),
  ],
);

export type AcademicTerm = typeof academicTerms.$inferSelect;
export type Department = typeof departments.$inferSelect;
export type Program = typeof programs.$inferSelect;
export type Course = typeof courses.$inferSelect;
export type Teacher = typeof teachers.$inferSelect;
export type Section = typeof sections.$inferSelect;
