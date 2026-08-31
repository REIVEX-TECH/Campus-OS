export const en = {
  'app.tagline': 'A multi-tenant, open-source campus platform.',

  'timetable.heading': 'Timetable',
  'timetable.viewTimetable': 'View timetable',
  'timetable.chooseSection': 'Choose a section',
  'timetable.section': 'Section',
  'timetable.teacher': 'Teacher',
  'timetable.room': 'Room',
  'timetable.time': 'Time',
  'timetable.timeRange': '{start} to {end}',
  'timetable.subscribe': 'Subscribe (ICS)',

  'timetable.tba': 'TBA',
  'timetable.tbaTeacherAria': 'Teacher to be announced',
  'timetable.tbaRoomAria': 'Room to be announced',
  'timetable.unverified': 'Unverified',
  'timetable.unverifiedAria': 'Imported automatically, pending review',
  'timetable.provenance':
    'Imported from the university portal; some details are pending verification.',
  'timetable.termDatesPending':
    'Term dates are pending, so the calendar feed recurs weekly without an end date.',

  'timetable.empty.noTerms': 'No timetable has been published yet.',
  'timetable.empty.noSections': 'No sections have been published for this term yet.',
  'timetable.empty.noEntries': 'No classes are scheduled yet.',

  'timetable.lastUpdated': 'Last updated {when}',
  'timetable.neverUpdated': 'Not yet imported',

  'timetable.gridCaption': 'Weekly timetable for {name}',
  'timetable.teacherTimetable': 'Teacher timetable',
  'timetable.roomTimetable': 'Room timetable',
  'timetable.cellAria': '{course}, {kind}, {day} {start} to {end}, teacher {teacher}, room {room}',

  'timetable.day.1': 'Monday',
  'timetable.day.2': 'Tuesday',
  'timetable.day.3': 'Wednesday',
  'timetable.day.4': 'Thursday',
  'timetable.day.5': 'Friday',
  'timetable.day.6': 'Saturday',
  'timetable.day.7': 'Sunday',

  'timetable.kind.lecture': 'Lecture',
  'timetable.kind.lab': 'Lab',
  'timetable.kind.tutorial': 'Tutorial',
  'timetable.kind.exam': 'Exam',

  'admin.rooms.heading': 'Room mapping',
  'admin.rooms.intro': 'Map each pending room name to a room so its classes stop showing TBA.',
  'admin.rooms.blocked': '{count} classes waiting',
  'admin.rooms.none': 'No rooms are pending. Every class has a room.',
  'admin.rooms.sourceName': 'Source name',
  'admin.rooms.modeNew': 'Create a new room',
  'admin.rooms.modeExisting': 'Map to an existing room',
  'admin.rooms.newRoomLabel': 'New room name',
  'admin.rooms.existingRoomLabel': 'Existing room',
  'admin.rooms.selectRoom': 'Select a room',
  'admin.rooms.resolve': 'Map room',
  'admin.rooms.resolved': '{count} classes resolved for {name}.',
  'admin.rooms.error': 'Could not map that room. Please check the details and try again.',
  'admin.rooms.signOut': 'Sign out',

  'admin.login.heading': 'Admin sign in',
  'admin.login.intro': 'Enter the admin secret for {tenant}.',
  'admin.login.passwordLabel': 'Admin secret',
  'admin.login.submit': 'Sign in',
  'admin.login.error': 'Incorrect secret.',
  'admin.login.disabled': 'Admin access is not configured on this deployment.',
  'admin.login.rateLimited': 'Too many attempts. Please wait a minute and try again.',

  'notFound.title': '404',
  'notFound.body': 'This tenant or page could not be found.',
} as const;
