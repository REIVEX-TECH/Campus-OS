import { z } from 'zod';

// Wire shapes for the public developer API. Hand-written from the documented
// behaviour; confirm against recorded fixtures when they are captured.

export const comboSchema = z.object({
  semester: z.string().min(1),
  program: z.string().min(1),
  section: z.string().min(1),
});

export const metadataSchema = z.object({
  combos: z.array(comboSchema),
});

const timeString = z.string().regex(/^\d{1,2}:\d{2}(:\d{2})?$/, 'expected HH:mm[:ss]');

export const rawSlotSchema = z.object({
  day: z.number().int().min(1).max(7),
  start: timeString,
  end: timeString,
  course: z.string().min(1),
  courseCode: z.string().min(1).optional(),
  teacher: z.string().min(1).nullish(),
  room: z.string().min(1).nullish(),
  type: z.string().min(1).optional(),
});

export const timetableSchema = z.object({
  slots: z.array(rawSlotSchema),
});

export type Combo = z.infer<typeof comboSchema>;
export type RawSlot = z.infer<typeof rawSlotSchema>;
